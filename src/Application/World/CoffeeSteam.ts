import * as THREE from 'three';
import Application from '../Application';
import Resources from '../Utils/Resources';
import Time from '../Utils/Time';
import { motionPreference } from '../Camera/CameraKeyframes';

import fragmentShader from '../Shaders/coffee/fragment.glsl';
import vertexShader from '../Shaders/coffee/vertex.glsl';

const STEAM_COLOR = '#c9c9c9';
const STEAM_SIZE = { w: 280, h: 700 };
const STEAM_POSITION = new THREE.Vector3(1670, 200, 900);
const STEAM_TIME_FREQUENCY = 0.001;
const STEAM_REDUCED_MOTION_RATE = 0.15;
const STEAM_UV_FREQUENCY = new THREE.Vector2(3, 5);

export default class CoffeeSteam {
    material: THREE.ShaderMaterial;
    mesh: THREE.Mesh;
    application: Application;
    resources: Resources;
    scene: THREE.Scene;
    time: Time;
    steamClock = 0;

    constructor() {
        this.application = new Application();
        this.resources = this.application.resources;
        this.scene = this.application.scene;
        this.time = this.application.time;

        this.setModel();
    }

    setModel() {
        this.material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            vertexShader,
            fragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uTimeFrequency: { value: STEAM_TIME_FREQUENCY },
                uUvFrequency: { value: STEAM_UV_FREQUENCY.clone() },
                uColor: { value: new THREE.Color(STEAM_COLOR) },
            },
        });

        this.mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(STEAM_SIZE.w, STEAM_SIZE.h),
            this.material
        );
        this.mesh.position.copy(STEAM_POSITION);

        this.scene.add(this.mesh);
    }

    update() {
        const rate = motionPreference.reduced ? STEAM_REDUCED_MOTION_RATE : 1;
        this.steamClock += this.time.delta * rate;
        this.material.uniforms.uTime.value = this.steamClock;

        // Y-axis billboard: face the camera so the plane never goes edge-on
        const cam = this.application.camera.instance.position;
        this.mesh.rotation.y = Math.atan2(
            cam.x - this.mesh.position.x,
            cam.z - this.mesh.position.z
        );
    }
}
