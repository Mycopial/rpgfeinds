lucide.createIcons();
const isMobile = window.innerWidth < 768;

// --- AUDIO SETUP ---
const audioToggle = document.getElementById('audio-toggle');
const audio = document.getElementById('ambiance-audio');
const volumeSlider = document.getElementById('volume-slider');
const volumeContainer = document.getElementById('volume-container');
let isMuted = true;

// Set initial volume
audio.volume = 0.5;

audioToggle.addEventListener('click', () => {
    if (isMuted) {
        audio.play().catch(e => console.log("Audio play failed:", e));
        isMuted = false;
        // Re-create the icon element so Lucide can process it again
        audioToggle.innerHTML = '<i data-lucide="volume-2" class="w-6 h-6"></i>';
        audioToggle.classList.add('animate-pulse');
        volumeContainer.classList.remove('hidden');
        volumeContainer.classList.add('volume-visible');
    } else {
        audio.pause();
        isMuted = true;
        audioToggle.innerHTML = '<i data-lucide="volume-x" class="w-6 h-6"></i>';
        audioToggle.classList.remove('animate-pulse');
        volumeContainer.classList.add('hidden');
        volumeContainer.classList.remove('volume-visible');
    }
    lucide.createIcons();
});

volumeSlider.addEventListener('input', (e) => {
    audio.volume = e.target.value;
});

// --- UI SETUP ---
const grid = document.getElementById('manifest-grid');
let currentTarget = null;

// --- D&D BEYOND INTEGRATION LOGIC ---
async function initManifests() {
    grid.innerHTML = ''; // Clear loading text

    PARTY_IDS.forEach((id, index) => {
        // Create Placeholder
        const card = document.createElement('div');
        card.className = 'manifest-card flex flex-col justify-center items-center';
        card.id = `card-${id}`;
        card.innerHTML = `<div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#00f3ff]"></div>`;
        grid.appendChild(card);

        // Setup Watcher Interaction immediately
        // Use random target coords from data.js or fallback to random point
        const coords = TARGET_COORDS[index % TARGET_COORDS.length];
        card.addEventListener('mouseenter', () => {
            currentTarget = new THREE.Vector3(coords.x, coords.y, coords.z);
            card.classList.add('targeting');
        });
        card.addEventListener('mouseleave', () => {
            currentTarget = null;
            card.classList.remove('targeting');
        });

        // Fetch
        fetchCharacter(id, card);
    });
}

async function fetchCharacter(id, cardEl) {
    const ddbApiUrl = `https://character-service.dndbeyond.com/character/v5/character/${id}`;
    try {
        const response = await fetch(PROXY_URL + encodeURIComponent(ddbApiUrl));
        if (!response.ok) throw new Error("Signal Lost");
        const json = await response.json();

        if (!json.success && !json.data) throw new Error("Corrupted Data");

        // Process Stats
        const finalStats = calculateAbilityScores(json.data);
        const totalLevel = json.data.classes.reduce((sum, c) => sum + c.level, 0);
        const hpData = calculateHP(json.data, finalStats[2].mod, totalLevel);

        renderCard(cardEl, json.data, hpData, totalLevel);

    } catch (err) {
        console.error(err);
        cardEl.innerHTML = `<div class="text-red-500 font-bold text-center">SIGNAL LOST<br><span class="text-xs opacity-50">${id}</span></div>`;
        cardEl.style.borderColor = "var(--color-avarice-red)";
    }
}

function renderCard(card, data, hpData, level) {
    const name = data.name || "Unknown";
    const race = data.race.fullName;
    const mainClass = data.classes[0].definition.name;
    const avatar = data.avatarUrl || data.decorations?.avatarUrl || "https://www.dndbeyond.com/content/skins/waterdeep/images/characters/default-avatar.png";
    const sheetUrl = data.readonlyUrl;

    // Status Calculation
    const hpPercent = (hpData.current / hpData.max) * 100;
    let status = "OPTIMAL";
    let statusColor = "text-[#4fffa8]";
    let barColor = "#4fffa8";

    if (hpPercent < 75) { status = "DAMAGED"; statusColor = "text-yellow-400"; barColor = "#facc15"; }
    if (hpPercent < 25) { status = "CRITICAL"; statusColor = "text-[#ff3333]"; barColor = "#ff3333"; }
    if (hpData.current <= 0) { status = "OFFLINE"; statusColor = "text-gray-500"; barColor = "#6b7280"; }

    card.className = 'manifest-card flex flex-col'; // Reset class to remove center alignment
    card.innerHTML = `
        <!-- New Overlay: Engage Data Stream -->
        <div class="datastream-overlay">
            <div class="datastream-text">>> ENGAGE DATA STREAM <<</div>
        </div>

        <div class="flex justify-between items-start w-full mb-4 relative z-0">
            <div class="flex items-center gap-3">
                <img src="${avatar}" class="ddb-avatar" alt="Av">
                <div>
                    <h3 class="text-lg font-bold text-white leading-none">${name}</h3>
                    <p class="text-xs text-gray-500 font-mono mt-1">${race} // ${mainClass} ${level}</p>
                </div>
            </div>
            <div class="text-xs border px-2 py-1 rounded ${statusColor} border-current font-bold tracking-wider">
                ${status}
            </div>
        </div>
        
        <div class="w-full mt-auto relative z-0">
            <div class="flex justify-between text-xs font-mono text-[#00f3ff] mb-1">
                <span>VITALS INTEGRITY</span>
                <span>${hpData.current} / ${hpData.max}</span>
            </div>
            <div class="hp-bar-bg">
                <div class="hp-bar-fill" style="width: ${hpPercent}%; background: ${barColor};"></div>
            </div>
        </div>
    `;

    // DIRECT LINK (Bypass Modal)
    card.addEventListener('click', () => {
        window.open(sheetUrl, '_blank');
    });
}

// --- MATH LOGIC ---
function calculateAbilityScores(data) {
    const stats = [0, 0, 0, 0, 0, 0].map((_, i) => ({
        value: (data.stats[i].value || 10) + ((data.bonusStats?.[i]?.value) || 0),
        mod: 0, id: i + 1
    }));

    const apply = (mod) => { if (mod.type === 'bonus' && mod.entityId >= 1 && mod.entityId <= 6) stats[mod.entityId - 1].value += mod.value; };
    const set = (mod) => { if (mod.type === 'set' && mod.entityId >= 1 && mod.entityId <= 6 && mod.value > stats[mod.entityId - 1].value) stats[mod.entityId - 1].value = mod.value; };
    const groups = ['race', 'class', 'background', 'feat', 'condition'];

    groups.forEach(g => data.modifiers[g]?.forEach(apply));
    data.modifiers.item?.forEach(m => { if (data.inventory.find(i => i.id === m.componentId)?.equipped) apply(m); });
    groups.forEach(g => data.modifiers[g]?.forEach(set));
    data.modifiers.item?.forEach(m => { if (data.inventory.find(i => i.id === m.componentId)?.equipped) set(m); });
    data.overrideStats?.forEach((s, i) => { if (s.value) stats[i].value = s.value; });

    return stats.map(s => ({ value: s.value, mod: Math.floor((s.value - 10) / 2) }));
}

function calculateHP(data, conMod, totalLevel) {
    let max = data.overrideHitPoints || ((data.baseHitPoints || 0) + (data.bonusHitPoints || 0) + (totalLevel * conMod));
    if (!data.overrideHitPoints) {
        const groups = ['race', 'class', 'background', 'item', 'feat', 'condition'];
        groups.forEach(g => data.modifiers[g]?.forEach(m => { if (m.type === 'bonus' && m.subType === 'hit-points-per-level') max += (m.value || 1) * totalLevel; }));
    }
    return { current: max - (data.removedHitPoints || 0), max: max };
}

// --- NAVIGATION LOGIC ---
const links = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('section');
const navContainer = document.getElementById('main-nav');
let isWarping = false;
let currentSection = 'home';

links.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = link.dataset.target;
        currentSection = target;

        links.forEach(l => l.classList.remove('active'));
        link.classList.add('active');

        sections.forEach(sec => sec.classList.remove('active'));
        document.getElementById(target).classList.add('active');

        // TRIGGER INIT IF MANIFESTS
        if (target === 'manifests') initManifests();

        triggerGlitch();
        moveCamera(target);
    });
});

function triggerGlitch() {
    if (navContainer.classList.contains('glitching')) return; // Prevent stacking

    navContainer.classList.add('glitching');
    navContainer.classList.add('ui-glitch-active');
    if (rgbShift) {
        gsap.to(rgbShift.uniforms['amount'], { value: 0.005, duration: 0.1, yoyo: true, repeat: 3 });
        gsap.to(rgbShift.uniforms['amount'], { value: 0, duration: 0.1, delay: 0.4 });
    }
    setTimeout(() => {
        navContainer.classList.remove('glitching');
        navContainer.classList.remove('ui-glitch-active');
    }, 400);
}

function moveCamera(target) {
    let pos = { x: 0, y: 0, z: 12 };
    let lookAt = { x: 0, y: 0, z: 0 };

    if (target === 'archive') {
        // Handled in loop via 'currentSection' check
    }
    else if (target === 'manifests') { pos = { x: -6, y: 5, z: 9 }; lookAt = { x: 2, y: -1, z: 0 }; }
    else if (target === 'protocols') { pos = { x: 0, y: -6, z: 10 }; lookAt = { x: 0, y: 2, z: 0 }; }
    else if (target === 'simulation') { pos = { x: 6, y: 4, z: 8 }; lookAt = { x: -2, y: 0, z: 0 }; }
    else if (target === 'comms') { pos = { x: -5, y: -2, z: 8 }; lookAt = { x: 2, y: 1, z: 0 }; }

    // Trigger Warp
    isWarping = true;
    controls.enabled = false; // Disable controls during warp

    if (target !== 'archive') {
        gsap.to(camera.position, {
            x: pos.x, y: pos.y, z: pos.z,
            duration: 1.8,
            ease: "power3.inOut",
            onComplete: () => {
                isWarping = false;
                controls.enabled = true; // Re-enable controls
            }
        });
        gsap.to(controls.target, {
            x: lookAt.x, y: lookAt.y, z: lookAt.z,
            duration: 1.8,
            ease: "power3.inOut"
        });
    } else {
        setTimeout(() => {
            isWarping = false;
            controls.enabled = true;
        }, 1800);
    }
}

// --- SERVER STATUS CHECK (Optimized) ---
const statusEl = document.getElementById('status-bar');

function checkServer() {
    // Run check and minimum delay in parallel
    const minDelay = new Promise(resolve => setTimeout(resolve, 2000));

    const check = new Promise((resolve, reject) => {
        const img = new Image();
        img.src = foundryUrl + "/icons/svg/d20-grey.svg?t=" + new Date().getTime();
        img.onload = resolve;
        img.onerror = reject;
    });

    Promise.allSettled([minDelay, check]).then(results => {
        // results[1] is the check result
        if (results[1].status === 'fulfilled') {
            // Success
            statusEl.innerHTML = '<span class="text-green-400">●</span> SYSTEM ONLINE // WATCHER PROTOCOL ACTIVE <span class="blink">_</span>';
            statusEl.style.color = "var(--color-watcher-cyan)";
            statusEl.style.borderColor = "rgba(0, 243, 255, 0.3)";
        } else {
            // Failure
            statusEl.innerHTML = '<span class="text-red-500">●</span> SIGNAL LOST // OFFLINE <span class="blink">_</span>';
            statusEl.style.color = "var(--color-avarice-red)";
            statusEl.style.borderColor = "rgba(255, 50, 50, 0.3)";
        }
    });
}

window.addEventListener('load', checkServer);

// --- MODAL LOGIC ---
const modal = document.getElementById('modal-backdrop');
const closeBtn = document.getElementById('modal-close');

function openModal(unit) {
    document.getElementById('m-name').textContent = unit.name;
    const statusEl = document.getElementById('m-status');
    statusEl.textContent = unit.status;
    statusEl.className = `text-xs border px-2 py-1 rounded ${unit.statusColor}`;
    document.getElementById('m-loc').textContent = unit.location;
    document.getElementById('m-alliance').textContent = unit.alliance;
    document.getElementById('m-mission').textContent = unit.mission;
    document.getElementById('m-desc').textContent = unit.desc;
    document.getElementById('m-link').href = unit.link;
    modal.classList.add('visible');
    triggerGlitch();
}
closeBtn.onclick = () => modal.classList.remove('visible');
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x030305, 0.02);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 12;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ReinhardToneMapping;
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enableZoom = false;

// --- POST PROCESSING ---
const composer = new THREE.EffectComposer(renderer);
const renderPass = new THREE.RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new THREE.UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5, 0.4, 0.85
);
bloomPass.threshold = 0;
bloomPass.strength = 1.5;
bloomPass.radius = 0.4;

if (!isMobile) {
    composer.addPass(bloomPass);
}

const rgbShift = new THREE.ShaderPass(THREE.RGBShiftShader);
rgbShift.uniforms['amount'].value = 0.000;
composer.addPass(rgbShift);

// --- OBJECTS ---

const planetGroup = new THREE.Group();
scene.add(planetGroup);

// 1. Planet Base
const geometry = new THREE.IcosahedronGeometry(3, 2);
const material = new THREE.MeshStandardMaterial({
    color: 0x1a2e28,
    roughness: 0.7,
    flatShading: true,
    emissive: 0x05100a,
    emissiveIntensity: 0.5
});
const planet = new THREE.Mesh(geometry, material);
planetGroup.add(planet);

// 2. Atmospheric Glow (Fresnel)
const atmosphereGeo = new THREE.SphereGeometry(3.3, 64, 64);
const atmosphereMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
        varying vec3 vNormal;
        void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        varying vec3 vNormal;
        void main() {
            float intensity = pow(0.6 - dot(vNormal, vec3(0, 0, 1.0)), 4.0);
            gl_FragColor = vec4(0.3, 1.0, 0.6, 1.0) * intensity;
        }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true
});
const atmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat);
planetGroup.add(atmosphere);

// 3. Phantom Node Net
const netGeo = new THREE.IcosahedronGeometry(3.05, 2);
const netMat = new THREE.MeshBasicMaterial({ visible: false });
const net = new THREE.Mesh(netGeo, netMat);
planetGroup.add(net);

const vertices = [];
const posAttribute = netGeo.attributes.position;
for (let i = 0; i < posAttribute.count; i++) {
    const v = new THREE.Vector3();
    v.fromBufferAttribute(posAttribute, i);
    vertices.push(v);
}

// 4. PHANTOM LEYLINE SYSTEM (Pooled)
const pulsePool = [];
const MAX_PULSES = isMobile ? 15 : 40;

const riverShader = {
    uniforms: {
        time: { value: 0 },
        color: { value: new THREE.Color(0xd946ef) },
        progress: { value: 0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 color;
        uniform float progress;
        varying vec2 vUv;
        void main() {
            float trail = 0.0;
            if(vUv.x < progress && vUv.x > progress - 0.8) {
                trail = 1.0 - (progress - vUv.x) / 0.8;
                trail = pow(trail, 2.0);
            }
            if(vUv.x > progress && vUv.x < progress + 0.05) {
                trail = 1.0 - (vUv.x - progress) / 0.05;
            }
            if(trail < 0.01) discard;
            gl_FragColor = vec4(color * 2.0, trail);
        }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
};

const masterPulseMaterial = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xd946ef) }, progress: { value: 0 } },
    vertexShader: riverShader.vertexShader,
    fragmentShader: riverShader.fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});

function initPulsePool() {
    for (let i = 0; i < MAX_PULSES; i++) {
        const startIdx = Math.floor(Math.random() * vertices.length);
        const start = vertices[startIdx];
        let endIdx = -1;
        let tries = 0;
        while (endIdx === -1 && tries < 50) {
            const testIdx = Math.floor(Math.random() * vertices.length);
            const dist = start.distanceTo(vertices[testIdx]);
            if (dist > 2.0 && dist < 4.5) endIdx = testIdx;
            tries++;
        }

        if (endIdx !== -1) {
            const end = vertices[endIdx];
            const mid = start.clone().add(end).multiplyScalar(0.5).normalize().multiplyScalar(3.05);
            const curve = new THREE.CatmullRomCurve3([start, mid, end]);
            const geo = new THREE.TubeGeometry(curve, 40, 0.01, 8, false);
            const mat = masterPulseMaterial.clone();
            const mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            planetGroup.add(mesh);
            pulsePool.push({ mesh, speed: 0, active: false, progress: 0 });
        } else {
            // Fallback: just pick a random point if distance check fails
            const end = vertices[Math.floor(Math.random() * vertices.length)];
            const mid = start.clone().add(end).multiplyScalar(0.5).normalize().multiplyScalar(3.05);
            const curve = new THREE.CatmullRomCurve3([start, mid, end]);
            const geo = new THREE.TubeGeometry(curve, 40, 0.01, 8, false);
            const mat = masterPulseMaterial.clone();
            const mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            planetGroup.add(mesh);
            pulsePool.push({ mesh, speed: 0, active: false, progress: 0 });
        }
    }
    console.log("Pulse Pool Initialized. Size:", pulsePool.length);
}

initPulsePool();

function spawnPulse() {
    const pulse = pulsePool.find(p => !p.active);
    if (pulse) {
        pulse.active = true;
        pulse.mesh.visible = true;
        pulse.mesh.material.uniforms.progress.value = -0.2;
        pulse.progress = -0.2;
        pulse.speed = 0.006 + Math.random() * 0.004;

        // Randomize orientation to prevent repetitive patterns
        pulse.mesh.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
    }
}

const watcherGroup = new THREE.Group();
scene.add(watcherGroup);
// Intact Moon
const paleMoon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 2), new THREE.MeshBasicMaterial({ color: 0x00f3ff, wireframe: true, transparent: true, opacity: 0.3 }));
watcherGroup.add(paleMoon);
const eyeCore = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
paleMoon.add(eyeCore);
const pupil = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.12, 32), new THREE.MeshBasicMaterial({ color: 0x00ffff, side: THREE.DoubleSide }));
pupil.position.z = 0.26; eyeCore.add(pupil);

const beamGeo = new THREE.CylinderGeometry(0.005, 0.04, 1, 8, 1, true);
beamGeo.translate(0, 0.5, 0);
beamGeo.rotateX(Math.PI / 2);
const beamMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
const beam = new THREE.Mesh(beamGeo, beamMat);
watcherGroup.add(beam);

const redMoon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: 0xff3333 }));
scene.add(redMoon);

const starCount = 15000;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(starCount * 3);
const starSizes = new Float32Array(starCount);
for (let i = 0; i < starCount; i++) {
    const x = (Math.random() - 0.5) * 400;
    const y = (Math.random() - 0.5) * 400;
    const z = (Math.random() - 0.5) * 400;
    starPos[i * 3] = x; starPos[i * 3 + 1] = y; starPos[i * 3 + 2] = z;
    starSizes[i] = Math.random();
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));

const starShaderMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, warpFactor: { value: 0 } },
    vertexShader: `
        attribute float size;
        uniform float warpFactor;
        varying float vAlpha;
        void main() {
            vec3 pos = position;
            pos.z += pos.z * warpFactor * 2.0; 
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = (size * 2.0 + warpFactor * 5.0) * (200.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
            vAlpha = 0.6 + size * 0.4;
        }
    `,
    fragmentShader: `
        varying float vAlpha;
        void main() {
            vec2 coord = gl_PointCoord - vec2(0.5);
            if(length(coord) > 0.5) discard;
            gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha);
        }
    `,
    transparent: true
});
const stars = new THREE.Points(starGeo, starShaderMat);
scene.add(stars);

scene.add(new THREE.AmbientLight(0x404040));
const sun = new THREE.PointLight(0xffffff, 1.5); sun.position.set(10, 10, 10); scene.add(sun);
planetGroup.add(new THREE.PointLight(0xd946ef, 1, 10));
paleMoon.add(new THREE.PointLight(0x00f3ff, 2, 5));

const mouse = new THREE.Vector2();
const dummyTarget = new THREE.Vector3();
document.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX - window.innerWidth / 2);
    mouse.y = (e.clientY - window.innerHeight / 2);
});

const clock = new THREE.Clock();
let spawnTimer = 0;
let orbitTime = 0;

function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();
    controls.update();

    planetGroup.rotation.y = time * 0.05;

    spawnTimer++;
    if (spawnTimer > 80) {
        spawnPulse();
        spawnTimer = 0;
    }

    pulsePool.forEach(p => {
        if (p.active) {
            p.progress += p.speed;
            p.mesh.material.uniforms.progress.value = p.progress;
            if (p.progress > 1.6) {
                p.active = false;
                p.mesh.visible = false;
            }
        }
    });

    // Continuous Orbit
    orbitTime += 0.002;
    watcherGroup.position.set(
        Math.cos(orbitTime) * 6,
        Math.sin(orbitTime) * 1,
        Math.sin(orbitTime) * 6
    );

    // CAMERA FOLLOW LOGIC
    if (currentSection === 'archive') {
        const toMoon = watcherGroup.position.clone().normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(up, toMoon).normalize();

        const targetCamPos = watcherGroup.position.clone();
        targetCamPos.add(toMoon.multiplyScalar(1.2));
        targetCamPos.add(right.multiplyScalar(1.0));
        targetCamPos.y += 0.5;

        camera.position.lerp(targetCamPos, 0.1);
        controls.target.lerp(watcherGroup.position, 0.1);

        // FIX: Rotate the GROUP to face camera, ensuring eye contact
        watcherGroup.lookAt(camera.position);

        // Reset child rotation to ensure alignment
        paleMoon.rotation.set(0, 0, 0);

    }
    else if (currentTarget) {
        const worldTarget = currentTarget.clone().normalize().multiplyScalar(3.05);
        worldTarget.applyMatrix4(planetGroup.matrixWorld);
        watcherGroup.lookAt(worldTarget);

        // Ensure proper orientation of components
        paleMoon.rotation.set(0, 0, 0);

        const dist = watcherGroup.position.distanceTo(worldTarget);
        beam.scale.z = dist;
        beamMat.opacity += (0.8 - beamMat.opacity) * 0.1;
    } else {
        dummyTarget.set(mouse.x * 0.01, -mouse.y * 0.01, 10);
        watcherGroup.lookAt(dummyTarget);
        // Ensure proper orientation
        paleMoon.rotation.set(0, 0, 0);

        beamMat.opacity += (0.0 - beamMat.opacity) * 0.1;
    }

    redMoon.position.set(Math.cos(time * 0.3) * 5, Math.sin(time * 0.5) * 2, Math.sin(time * 0.4) * 7);

    if (isWarping) {
        starShaderMat.uniforms.warpFactor.value += (1.0 - starShaderMat.uniforms.warpFactor.value) * 0.05;
        if (rgbShift) rgbShift.uniforms['amount'].value += (0.005 - rgbShift.uniforms['amount'].value) * 0.1;
    } else {
        starShaderMat.uniforms.warpFactor.value += (0.0 - starShaderMat.uniforms.warpFactor.value) * 0.05;
        if (rgbShift) rgbShift.uniforms['amount'].value += (0.0 - rgbShift.uniforms['amount'].value) * 0.1;
    }
    stars.rotation.y = time * 0.002;

    composer.render();
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

animate();
