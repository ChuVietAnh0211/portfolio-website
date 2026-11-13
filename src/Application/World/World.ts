import * as THREE from 'three';
import Application from '../Application';
import Resources from '../Utils/Resources';
import ComputerSetup from './Computer';
import MonitorScreen from './MonitorScreen';
import Environment from './Environment';
import Decor from './Decor';
import CoffeeSteam from './CoffeeSteam';
import AudioManager from '../Audio/AudioManager';
import Time from '../Utils/Time';

/** Baked models and the resources each one needs */
const BAKED_OBJECTS = {
    environment: { model: 'environmentModel', texture: 'environmentTexture' },
    decor: { model: 'decorModel', texture: 'decorTexture' },
    computerSetup: {
        model: 'computerSetupModel',
        texture: 'computerSetupTexture',
    },
};

export default class World {
    application: Application;
    scene: THREE.Scene;
    resources: Resources;

    // Objects in the scene (each may be missing if its build failed)
    environment?: Environment;
    decor?: Decor;
    computerSetup?: ComputerSetup;
    monitorScreen?: MonitorScreen;
    coffeeSteam?: CoffeeSteam;
    audioManager?: AudioManager;

    private time: Time;
    private onPause: () => void;
    private onResume: () => void;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.resources = this.application.resources;
        this.time = this.application.time;
        // Wait for resources
        this.resources.on('ready', () => this.build());

        // Tab hidden/visible: pause/resume the monitor's video textures
        this.onPause = () => this.monitorScreen?.setVideosPlaying(false);
        this.onResume = () => this.monitorScreen?.setVideosPlaying(true);
        this.time.on('pause.world', this.onPause);
        this.time.on('resume.world', this.onResume);
    }

    /**
     * Builds every scene object independently, so one missing asset or
     * failing constructor only drops that object instead of the whole world.
     */
    private build() {
        if (this.hasBakedAssets('environment')) {
            this.environment = this.tryCreate('environment', Environment);
        }
        if (this.hasBakedAssets('decor')) {
            this.decor = this.tryCreate('decor', Decor);
        }
        if (this.hasBakedAssets('computerSetup')) {
            this.computerSetup = this.tryCreate('computerSetup', ComputerSetup);
        }
        this.monitorScreen = this.tryCreate('monitorScreen', MonitorScreen);
        this.coffeeSteam = this.tryCreate('coffeeSteam', CoffeeSteam);
        this.audioManager = this.tryCreate('audioManager', AudioManager);
    }

    private hasBakedAssets(name: keyof typeof BAKED_OBJECTS) {
        const { model, texture } = BAKED_OBJECTS[name];
        const items = this.resources.items;
        if (items.gltfModel[model] && items.texture[texture]) return true;
        console.warn(
            `World: skipping ${name}, missing resource(s):`,
            [
                items.gltfModel[model] ? null : model,
                items.texture[texture] ? null : texture,
            ].filter(Boolean)
        );
        return false;
    }

    private tryCreate<T>(name: string, Ctor: new () => T): T | undefined {
        try {
            return new Ctor();
        } catch (error) {
            console.warn(`World: failed to create ${name}, skipping.`, error);
            return undefined;
        }
    }

    update() {
        this.monitorScreen?.update();
        this.coffeeSteam?.update();
        this.audioManager?.update();
    }

    dispose() {
        this.time.off('pause.world');
        this.time.off('resume.world');

        this.monitorScreen?.dispose();

        for (const baked of [this.environment, this.decor, this.computerSetup]) {
            if (baked) this.scene.remove(baked.bakedModel.getModel());
        }

        const audio = this.audioManager as unknown as
            | { dispose?: () => void }
            | undefined;
        if (audio && 'dispose' in audio && typeof audio.dispose === 'function') {
            audio.dispose();
        }

        const steam = this.coffeeSteam;
        if (steam?.mesh) {
            this.scene.remove(steam.mesh);
            steam.mesh.geometry.dispose();
            steam.material.dispose();
        }
    }
}
