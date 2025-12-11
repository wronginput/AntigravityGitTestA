// Pixel Physics Racer
// Uses Matter.js for 2D physics

const { Engine, Render, Runner, World, Bodies, Body, Composite, Composites, Constraint, Vector, Events } = Matter;

// Configuration
const CONFIG = {
    zoom: 1,
    chunkWidth: 1000,
    terrainRoughness: 100,
    terrainSmoothness: 0.003,
    // Ball Physics
    ballSize: 15,
    ballSpeed: 0.4, // Faster max rolling speed
    ballTorque: 0.5, // 10x torque for climbing power
    jumpForce: 0.35,
};

// Global State
let engine, world, runner;
let renderCanvas, ctx;
let playerBody; // The rolling ball
let terrainBodies = []; // Array of arrays (chunks of segments)
let scrollOffset = 0;
let lastTerrainX = -800;
let noiseSeed = Math.random() * 1000;

// Audio Context
let audioCtx;
let engineOsc;
let engineGain;

function init() {
    engine = Engine.create();
    world = engine.world;
    engine.gravity.y = 1.5;

    renderCanvas = document.createElement('canvas');
    ctx = renderCanvas.getContext('2d');
    document.body.appendChild(renderCanvas);

    window.addEventListener('resize', handleResize);
    handleResize();

    createPlayer(0, 0);

    // Initial Terrain
    for (let i = 0; i < 3; i++) {
        generateTerrainChunk();
    }

    // Input
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            jump();
            initAudio();
        }
    });
    document.addEventListener('mousedown', initAudio);

    runner = Runner.create();
    Runner.run(runner, engine);

    requestAnimationFrame(renderLoop);
    Events.on(engine, 'beforeUpdate', updateGame);
}

function handleResize() {
    renderCanvas.width = window.innerWidth;
    renderCanvas.height = window.innerHeight;
    ctx.imageRendering = 'pixelated';
}

// --- Terrain Generation ---
function noise(x) {
    const y = Math.sin(x) * 10000;
    return y - Math.floor(y);
}

function smoothNoise(x) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3.0 - 2.0 * f);
    return noise(i) * (1 - u) + noise(i + 1) * u;
}

function getTerrainHeight(x) {
    const val1 = smoothNoise(x * CONFIG.terrainSmoothness + noiseSeed);
    const val2 = smoothNoise(x * CONFIG.terrainSmoothness * 5 + noiseSeed + 100);
    const rawHeight = (val1 * 300) + (val2 * 80);
    return rawHeight; // No quantization needed for physics, looks smoother
}

function generateTerrainChunk() {
    const startX = lastTerrainX;
    const endX = startX + CONFIG.chunkWidth;
    const segmentWidth = 20; // Distance between points (fidelity)

    let prevX = startX;
    let prevY = 400 + getTerrainHeight(startX);

    const chunkBodies = [];
    const chunkPath = []; // For rendering single line

    for (let x = startX + segmentWidth; x <= endX; x += segmentWidth) {
        let currentY = 400 + getTerrainHeight(x);

        // Create a segment connecting prev point to current point
        const midpointX = (prevX + x) / 2;
        const midpointY = (prevY + currentY) / 2;
        const length = Math.hypot(x - prevX, currentY - prevY);
        const angle = Math.atan2(currentY - prevY, x - prevX);

        const segment = Bodies.rectangle(midpointX, midpointY, length + 2, 20, { // Thick floor for safety
            isStatic: true,
            angle: angle,
            friction: 1.0,
            frictionStatic: 10,
            label: "ground",
            render: { visible: false } // We draw manually
        });

        World.add(world, segment);
        chunkBodies.push(segment);
        chunkPath.push({ x: prevX, y: prevY });

        prevX = x;
        prevY = currentY;
    }
    // Add last point to path
    chunkPath.push({ x: prevX, y: prevY });

    // Store the bodies and the path for rendering
    terrainBodies.push({ bodies: chunkBodies, path: chunkPath });
    lastTerrainX = endX;
}

// --- Player (Rolling Ball) ---
function createPlayer(x, y) {
    playerBody = Bodies.circle(x, y - 50, CONFIG.ballSize, {
        friction: 1.0,         // Max grip
        frictionAir: 0.001,
        restitution: 0.0,      // No bounce to keep contact
        density: 0.2,          // Heavier for momentum
        label: "player"
    });
    World.add(world, playerBody);
}

function jump() {
    if (!playerBody) return;
    // Simple vertical impulse
    Body.applyForce(playerBody, playerBody.position, { x: 0, y: -CONFIG.jumpForce });
    playJumpSound();
}

function updateGame() {
    if (!playerBody) return;

    // 1. Roll Logic (Torque)
    // We want the ball to roll forward. 
    // Applying torque mimics a "motor" inside the ball.
    // Or we can just set angular velocity.

    if (playerBody.angularVelocity < CONFIG.ballSpeed) {
        playerBody.torque = CONFIG.ballTorque;
    }

    // 2. Camera
    const targetX = playerBody.position.x;
    const screenCenter = renderCanvas.width / 2;
    scrollOffset = -targetX + screenCenter;

    // 3. Infinite Terrain
    if (playerBody.position.x > lastTerrainX - CONFIG.chunkWidth * 2) {
        generateTerrainChunk();
    }

    // Cleanup chunks
    if (terrainBodies.length > 5) {
        const oldChunk = terrainBodies.shift();
        World.remove(world, oldChunk.bodies);
    }

    // 4. Reset
    if (playerBody.position.y > 2000) {
        Body.setPosition(playerBody, { x: playerBody.position.x, y: 0 });
        Body.setVelocity(playerBody, { x: 0, y: 0 });
        Body.setAngularVelocity(playerBody, 0);
    }

    // Sound
    updateEngineSound(playerBody.angularSpeed * 10);
}

// --- Rendering ---
function renderLoop() {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);

    ctx.save();

    const centerY = renderCanvas.height / 2;
    // Follow Y loosely
    const targetY = -playerBody.position.y + centerY + 100;
    ctx.translate(scrollOffset, targetY);

    // Draw Terrain Line
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    terrainBodies.forEach(chunk => {
        const path = chunk.path;
        if (path.length > 0) {
            ctx.moveTo(path[0].x, path[0].y);
            for (let i = 1; i < path.length; i++) {
                ctx.lineTo(path[i].x, path[i].y);
            }
        }
    });
    ctx.stroke();

    // Draw Player Ball
    if (playerBody) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        const pos = playerBody.position;
        const r = CONFIG.ballSize;
        ctx.arc(pos.x, pos.y, r, 0, 2 * Math.PI);
        ctx.fill();

        // Draw 'spokes' to see rotation
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x + Math.cos(playerBody.angle) * r, pos.y + Math.sin(playerBody.angle) * r);
        ctx.stroke();
    }

    ctx.restore();
    requestAnimationFrame(renderLoop);
}

// --- Audio ---
function initAudio() {
    if (audioCtx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();

    engineOsc = audioCtx.createOscillator();
    engineGain = audioCtx.createGain();
    engineOsc.type = 'triangle';
    engineOsc.frequency.value = 50;
    engineGain.gain.value = 0.0;
    engineOsc.connect(engineGain);
    engineGain.connect(audioCtx.destination);
    engineOsc.start();
}

function updateEngineSound(param) {
    if (!audioCtx) return;
    const baseFreq = 60;
    const targetFreq = baseFreq + param * 20;
    engineOsc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.1);
    engineGain.gain.setTargetAtTime(0.05, audioCtx.currentTime, 0.1);
}

function playJumpSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
}

window.onload = init;
