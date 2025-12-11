// Pixel Physics Racer
// Uses Matter.js for 2D physics

const { Engine, Render, Runner, World, Bodies, Body, Composite, Composites, Constraint, Vector, Events } = Matter;

// Configuration
const CONFIG = {
    zoom: 1,
    pixelScale: 4,
    chunkWidth: 1000,
    terrainRoughness: 150, // Much higher variability
    terrainSmoothness: 0.002, // Lower frequency for larger hills
    carSpeed: 0.15, // Significantly faster
    jumpForce: 0.6, // Stronger jump (increased from 0.5)
};

// Global State
let engine, world, runner;
let renderCanvas, ctx;
let carBody, carWheelB, carWheelF;
let terrainBodies = [];
let scrollOffset = 0;
let lastTerrainX = -800; // Start back so car has ground
let noiseSeed = Math.random() * 1000;

// Audio Context
let audioCtx;
let engineOsc;
let engineGain;

function init() {
    // 1. Setup Matter.js
    engine = Engine.create();
    world = engine.world;
    engine.gravity.y = 2.0; // Stronger gravity for tighter controls

    // 2. Setup Canvas & Custom Renderer
    renderCanvas = document.createElement('canvas');
    ctx = renderCanvas.getContext('2d');
    document.body.appendChild(renderCanvas);

    // Handle resize
    window.addEventListener('resize', handleResize);
    handleResize();

    // 3. Create Objects
    createCar(0, 0);

    // Initial Terrain
    for (let i = 0; i < 3; i++) {
        generateTerrainChunk();
    }

    // 4. Input
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            jump();
            initAudio(); // Resume audio context if suspended
        }
    });

    document.addEventListener('mousedown', initAudio);

    // 5. Run Loop
    runner = Runner.create();
    Runner.run(runner, engine);

    // Custom Render Loop
    requestAnimationFrame(renderLoop);

    // Game Update Loop
    Events.on(engine, 'beforeUpdate', updateGame);
}

function handleResize() {
    renderCanvas.width = window.innerWidth;
    renderCanvas.height = window.innerHeight;
    ctx.imageRendering = 'pixelated';
}

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
    // More complex noise for "bumps and jumps"
    const val1 = smoothNoise(x * CONFIG.terrainSmoothness + noiseSeed);
    const val2 = smoothNoise(x * CONFIG.terrainSmoothness * 5 + noiseSeed + 100); // Higher freq detail
    // Mix large hills (val1) with choppy bumps (val2)
    const rawHeight = (val1 * 300) + (val2 * 50);
    return Math.floor(rawHeight / CONFIG.pixelScale) * CONFIG.pixelScale;
}

function generateTerrainChunk() {
    const startX = lastTerrainX;
    const endX = startX + CONFIG.chunkWidth;
    const segmentWidth = 10; // Finer segments for smoother curve

    const vertices = [];
    vertices.push({ x: startX, y: 2000 }); // Bottom left (deep down)

    // Generate top surface points
    for (let x = startX; x <= endX; x += segmentWidth) {
        let y = 400 + getTerrainHeight(x);
        vertices.push({ x: x, y: y });
    }

    vertices.push({ x: endX, y: 2000 }); // Bottom right

    const ground = Bodies.fromVertices(
        (startX + endX) / 2,
        1200, // Center Y approx
        [vertices],
        {
            isStatic: true,
            friction: 1.0, // High friction for grip
            label: "ground"
        },
        true
    );

    // Store the "Top Surface" vertices for rendering explicitly
    // Matter.js decomposes vertices, so we can't trust body.vertices to be the exact line we drew.
    // We'll attach the drawing path directly to the body object for our renderer.
    ground.renderPath = [];
    for (let x = startX; x <= endX; x += segmentWidth) {
        let y = 400 + getTerrainHeight(x);
        ground.renderPath.push({ x, y });
    }

    World.add(world, ground);
    terrainBodies.push(ground);
    lastTerrainX = endX;
}

function createCar(x, y) {
    const group = Body.nextGroup(true);

    const wheelSpec = {
        collisionFilter: { group: group },
        friction: 0.9,
        restitution: 0.0, // Less bouncy wheels, more grip
        density: 0.05
    };

    // Chassis
    const chassis = Bodies.rectangle(x, y - 20, 50, 24, {
        collisionFilter: { group: group },
        density: 0.1, // Heavier chassis
        label: "car"
    });

    // Wheels
    carWheelB = Bodies.circle(x - 20, y + 10, 12, wheelSpec);
    carWheelF = Bodies.circle(x + 20, y + 10, 12, wheelSpec);

    // Suspension
    const stiffness = 0.15;
    const damping = 0.2; // More damping to stop springing uncontrollably

    const axelB = Constraint.create({
        bodyA: chassis,
        bodyB: carWheelB,
        pointA: { x: -20, y: 10 },
        stiffness: stiffness,
        damping: damping,
        length: 5
    });

    const axelF = Constraint.create({
        bodyA: chassis,
        bodyB: carWheelF,
        pointA: { x: 20, y: 10 },
        stiffness: stiffness,
        damping: damping,
        length: 5
    });

    carBody = Composite.create();
    Composite.add(carBody, [chassis, carWheelB, carWheelF, axelB, axelF]);
    World.add(world, carBody);
}

function jump() {
    if (!carBody) return;
    const chassis = carBody.bodies[0];
    // Strong upward force
    Body.applyForce(chassis, chassis.position, { x: 0, y: -CONFIG.jumpForce });

    // Small torque to pitch up slightly
    Body.setAngularVelocity(chassis, chassis.angularVelocity - 0.05);

    playJumpSound();
}

function updateGame() {
    if (!carBody) return;

    // 1. Auto Drive
    carWheelB.angularVelocity = CONFIG.carSpeed;
    carWheelF.angularVelocity = CONFIG.carSpeed;

    // Limit Max Speed to prevent chaos
    const maxSpeed = 30;
    if (carWheelB.speed > maxSpeed) Body.setSpeed(carWheelB, maxSpeed);
    if (carWheelF.speed > maxSpeed) Body.setSpeed(carWheelF, maxSpeed);

    // 2. Camera
    const chassis = carBody.bodies[0];
    const targetX = chassis.position.x;
    const screenCenter = renderCanvas.width / 2;
    scrollOffset = -targetX + screenCenter;

    // 3. Terrain Generation
    if (chassis.position.x > lastTerrainX - CONFIG.chunkWidth * 2) {
        generateTerrainChunk();
    }

    // Cleanup
    if (terrainBodies.length > 8) {
        const oldBody = terrainBodies.shift();
        World.remove(world, oldBody);
    }

    // 4. Audio & Reset
    updateEngineSound(chassis.speed);

    if (chassis.position.y > 3000) {
        // Reset Car significantly above last know terrain X
        Body.setPosition(chassis, { x: chassis.position.x, y: 0 });
        Body.setVelocity(chassis, { x: 0, y: 0 });
        Body.setAngularVelocity(chassis, 0);
        Body.setPosition(carWheelB, { x: chassis.position.x - 20, y: 20 });
        Body.setPosition(carWheelF, { x: chassis.position.x + 20, y: 20 });
    }
}

function renderLoop() {
    // Clear
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);

    ctx.save();

    const chassis = carBody.bodies[0];
    const centerY = renderCanvas.height / 2;

    // Smooth camera follow on Y
    const targetY = -chassis.position.y + centerY + 150;

    // Simple lerp or just lock it for now to avoid jitter
    ctx.translate(scrollOffset, targetY);

    // Draw Terrain Lines
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4; // Thick pixel line
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    terrainBodies.forEach(body => {
        if (body.renderPath) {
            ctx.beginPath();
            const path = body.renderPath;
            // Draw the line strip
            ctx.moveTo(path[0].x, path[0].y);
            for (let i = 1; i < path.length; i++) {
                ctx.lineTo(path[i].x, path[i].y);
            }
            ctx.stroke();
        }
    });

    // Draw Car
    ctx.fillStyle = '#fff';
    if (carBody) {
        carBody.bodies.forEach(body => {
            // Draw car parts as solid blocks
            ctx.beginPath();
            const v = body.vertices;
            ctx.moveTo(v[0].x, v[0].y);
            for (let j = 1; j < v.length; j++) {
                ctx.lineTo(v[j].x, v[j].y);
            }
            ctx.lineTo(v[0].x, v[0].y);
            ctx.fill();
        });
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

    engineOsc.type = 'square';
    engineOsc.frequency.value = 50;
    engineGain.gain.value = 0.0;

    engineOsc.connect(engineGain);
    engineGain.connect(audioCtx.destination);
    engineOsc.start();
}

function updateEngineSound(speed) {
    if (!audioCtx) return;
    const baseFreq = 40;
    const targetFreq = baseFreq + (speed * 8);
    engineOsc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.1);
    engineGain.gain.setTargetAtTime(0.05, audioCtx.currentTime, 0.1);
}

function playJumpSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(300, audioCtx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
}

window.onload = init;
