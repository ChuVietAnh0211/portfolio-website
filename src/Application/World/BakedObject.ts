import * as THREE from 'three';
import Application from '../Application';
import BakedModel from '../Utils/BakedModel';
import Resources from '../Utils/Resources';

export const MODEL_SCALE = 900;

/**
 * Shared base for the baked-texture scene models (environment, decor, computer).
 */
export default class BakedObject {
    application: Application;
    scene: THREE.Scene;
    resources: Resources;
    bakedModel: BakedModel;

    constructor(modelName: string, textureName: string) {
        this.application = new Application();
        this.scene = this.application.scene;
        this.resources = this.application.resources;

        this.bakedModel = new BakedModel(
            this.resources.items.gltfModel[modelName],
            this.resources.items.texture[textureName],
            MODEL_SCALE
        );
        this.scene.add(this.bakedModel.getModel());
    }
}
