// Pixel Physics Racer
// Uses Matter.js for 2D physics

const { Engine, Render, Runner, World, Bodies, Body, Composite, Composites, Constraint, Vector, Events } = Matter;

// Configuration
const CONFIG = {
    zoom: 1, // Visual zoom level (higher = more zoomed in)
    pixelScale: 4, // Visual size of one "physics unit" in pixels
    chunkWidth: 800,
    terrainRoughness: 60, // Height variance
    terrainSmoothness: 0.003, // Noise frequency
    carSpeed: 0.05, // Motor speed
    jumpForce: 0.3,
};

// Global State
let engine, world, runner;
let renderCanvas, ctx;
let carBody, carWheelB, carWheelF;
let terrainBodies = [];
let scrollOffset = 0;
let lastTerrainX = 0;
let noiseSeed = Math.random() * 1000;

// Audio Context
let audioCtx;
let engineOsc;
let engineGain;

function init() {
    // 1. Setup Matter.js
    engine = Engine.create();
    world = engine.world;
    engine.gravity.y = 1.5; // Slightly heavier gravity for snappy feel

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
    for(let i=0; i<3; i++) {
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

    // Game Update Loop (for infinite generation and sounds)
    Events.on(engine, 'beforeUpdate', updateGame);
}

function handleResize() {
    renderCanvas.width = window.innerWidth;
    renderCanvas.height = window.innerHeight;
    // Keep crisp pixels
    ctx.imageRendering = 'pixelated';
}

function noise(x) {
    // Simple 1D pseudo-random noise
    const y = Math.sin(x) * 10000;
    return y - Math.floor(y);
}

// Better 1D smooth noise
function smoothNoise(x) {
    const i = Math.floor(x);
    const f = x - i;
    // Cubic interpolation
    const u = f * f * (3.0 - 2.0 * f);
    return noise(i) * (1 - u) + noise(i + 1) * u;
}

function getTerrainHeight(x) {
    // Combine frequencies for undulating look
    const val1 = smoothNoise(x * CONFIG.terrainSmoothness + noiseSeed);
    const val2 = smoothNoise(x * CONFIG.terrainSmoothness * 3 + noiseSeed + 100);
    return Math.floor((val1 * 100 + val2 * 30) / CONFIG.pixelScale) * CONFIG.pixelScale; // Quantize for pixel look
}

function generateTerrainChunk() {
    const startX = lastTerrainX;
    const endX = startX + CONFIG.chunkWidth;
    const segmentWidth = 20; // Resolution of physics ground

    const vertices = [];
    vertices.push({ x: startX, y: 1000 }); // Bottom left

    for (let x = startX; x <= endX; x += segmentWidth) {
        let y = 300 + getTerrainHeight(x);
        vertices.push({ x: x, y: y });
    }

    vertices.push({ x: endX, y: 1000 }); // Bottom right

    const ground = Bodies.fromVertices(
        (startX + endX) / 2,
        650, // Approximate center Y
        [vertices],
        { 
            isStatic: true,
            friction: 0.8,
            render: { visible: true },
            label: "ground"
        },
        true // Flag for flattening indices, important for concave shapes but terrain is mostly convex-ish top
    );
    
    // Fix positioning after creation (Bodies.fromVertices centers based on Centroid)
    // We align it purely visually in render, but for physics we need to trust it matches
    // A simpler approach for infinite terrain is chain of trapezoids, but let's try this
    
    World.add(world, ground);
    terrainBodies.push(ground);
    lastTerrainX = endX;
}

function createCar(x, y) {
    const group = Body.nextGroup(true);

    const wheelSpec = { 
        collisionFilter: { group: group }, 
        friction: 0.9,
        restitution: 0.2, // Bouncy wheels
        density: 0.01 
    };

    // Chassis
    // Using a pixel art shape: a rectangle
    const chassis = Bodies.rectangle(x, y - 20, 60, 20, { 
        collisionFilter: { group: group },
        density: 0.04,
        label: "car"
    });

    // Wheels
    carWheelB = Bodies.circle(x - 20, y, 10, wheelSpec);
    carWheelF = Bodies.circle(x + 20, y, 10, wheelSpec);

    // Suspension
    const axelB = Constraint.create({
        bodyA: chassis,
        bodyB: carWheelB,
        pointA: { x: -20, y: 10 },
        stiffness: 0.2,
        damping: 0.1,
        length: 2
    });

    const axelF = Constraint.create({
        bodyA: chassis,
        bodyB: carWheelF,
        pointA: { x: 20, y: 10 },
        stiffness: 0.2,
        damping: 0.1,
        length: 2
    });

    carBody = Composite.create();
    Composite.add(carBody, [chassis, carWheelB, carWheelF, axelB, axelF]);
    World.add(world, carBody);
}

function jump() {
    if (!carBody) return;
    const chassis = carBody.bodies[0];
    
    // Only jump if touching ground (approximate check: Vertical velocity is low)
    // Or just double jump for fun
    Body.applyForce(chassis, chassis.position, { x: 0, y: -CONFIG.jumpForce });
    
    // Jump Sound
    playJumpSound();
}

function updateGame() {
    if (!carBody) return;

    // 1. Auto Drive
    // Apply torque to wheels
    carWheelB.angularVelocity = CONFIG.carSpeed;
    carWheelF.angularVelocity = CONFIG.carSpeed;

    // 2. Camera Follow (Calculate Scroll)
    const chassis = carBody.bodies[0];
    const targetX = chassis.position.x;
    const screenCenter = renderCanvas.width / 2;
    // Smooth scroll could be here, but direct lock is fine for retro feel
    scrollOffset = -targetX + screenCenter;

    // 3. Infinite Terrain Generation
    // If car is getting close to the edge of generated terrain
    if (chassis.position.x > lastTerrainX - CONFIG.chunkWidth * 2) {
        generateTerrainChunk();
    }
    
    // Cleanup old chunks
    if (terrainBodies.length > 5) {
        const oldBody = terrainBodies.shift();
        World.remove(world, oldBody);
    }

    // 4. Update Engine Sound
    updateEngineSound(chassis.speed);

    // 5. Reset if fell off world
    if (chassis.position.y > 2000) {
        // Reset Car
        Body.setPosition(chassis, { x: chassis.position.x, y: 0 });
        Body.setVelocity(chassis, { x: 0, y: 0 });
        Body.setAngularVelocity(chassis, 0);
        Body.setPosition(carWheelB, { x: chassis.position.x - 20, y: 20 });
        Body.setPosition(carWheelF, { x: chassis.position.x + 20, y: 20 });
    }
}

// Graphic Utils
function drawBody(body) {
    if (body.parts && body.parts.length > 1) {
        // Compound body or Hull
        for (let i = 1; i < body.parts.length; i++) {
            drawVertices(body.parts[i].vertices);
        }
    } else {
        drawVertices(body.vertices);
    }
}

function drawVertices(vertices) {
    ctx.beginPath();
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let j = 1; j < vertices.length; j += 1) {
        ctx.lineTo(vertices[j].x, vertices[j].y);
    }
    ctx.lineTo(vertices[0].x, vertices[0].y);
    // Draw with slight pixel stepping if we wanted to be super pedantic, 
    // but just filling the shape usually looks "vector" not "pixel".
    // To fake pixel art, we could quantize these coords?
    // For now, clean Vector lines on a pixelated canvas looks like "Vector Monitor" games (Battlezone etc)
    // whcih fits the "Dark background white graphics" vibe perfectly.
    ctx.fillStyle = '#fff';
    ctx.fill();
    // ctx.strokeStyle = '#fff';
    // ctx.lineWidth = 2;
    // ctx.stroke();
}

function renderLoop() {
    // Clear
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);

    ctx.save();
    
    // Apply Camera
    const chassis = carBody.bodies[0];
    const centerY = renderCanvas.height / 2;
    // Vertical camera follow with smoothing
    // let camY = -chassis.position.y + centerY; 
    // Just lock Y to somewhat ground level? 
    // Let's track car Y loosely
    ctx.translate(scrollOffset, -chassis.position.y + centerY + 100);

    // Draw Terrain
    // Terrain is handled by bodies right now, but we can draw them
    terrainBodies.forEach(drawBody);

    // Draw Car
    if (carBody) {
        carBody.bodies.forEach(drawBody);
    }

    ctx.restore();

    requestAnimationFrame(renderLoop);
}

// --- Audio ---
function initAudio() {
    if (audioCtx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();

    // Engine Sound Node
    engineOsc = audioCtx.createOscillator();
    engineGain = audioCtx.createGain();
    
    engineOsc.type = 'square'; // 8-bit sound
    engineOsc.frequency.value = 50;
    
    engineGain.gain.value = 0.0;
    
    engineOsc.connect(engineGain);
    engineGain.connect(audioCtx.destination);
    engineOsc.start();
}

function updateEngineSound(speed) {
    if (!audioCtx) return;
    // Pitch modulation based on speed
    const baseFreq = 60;
    const targetFreq = baseFreq + (speed * 10); // Speed usually 0-20
    
    // Smooth transition
    engineOsc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.1);
    
    // Volume based on if we are moving? Always on for "Engine" feeling
    engineGain.gain.setTargetAtTime(0.1, audioCtx.currentTime, 0.1);
}

function playJumpSound() {
    if (!audioCtx) return;
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

// Start
window.onload = init;
