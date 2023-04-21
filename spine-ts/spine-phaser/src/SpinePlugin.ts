/******************************************************************************
 * Spine Runtimes License Agreement
 * Last updated September 24, 2021. Replaces all prior versions.
 *
 * Copyright (c) 2013-2021, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software
 * or otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THE SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

import Phaser from "phaser";
import { SPINE_ATLAS_CACHE_KEY, SPINE_CONTAINER_TYPE, SPINE_GAME_OBJECT_TYPE, SPINE_ATLAS_TEXTURE_CACHE_KEY, SPINE_SKELETON_DATA_FILE_TYPE, SPINE_ATLAS_FILE_TYPE, SPINE_SKELETON_FILE_CACHE_KEY as SPINE_SKELETON_DATA_CACHE_KEY } from "./keys";
import { AtlasAttachmentLoader, Bone, GLTexture, SceneRenderer, Skeleton, SkeletonBinary, SkeletonData, SkeletonJson, TextureAtlas } from "@esotericsoftware/spine-webgl"
import { SpineGameObject, SpineGameObjectBoundsProvider } from "./SpineGameObject";
import { CanvasTexture, SkeletonRenderer } from "@esotericsoftware/spine-canvas";

export class SpinePlugin extends Phaser.Plugins.ScenePlugin {
	game: Phaser.Game;
	isWebGL: boolean;
	gl: WebGLRenderingContext | null;
	textureManager: Phaser.Textures.TextureManager;
	phaserRenderer: Phaser.Renderer.Canvas.CanvasRenderer | Phaser.Renderer.WebGL.WebGLRenderer | null;
	webGLRenderer: SceneRenderer | null;
	canvasRenderer: SkeletonRenderer | null;
	skeletonDataCache: Phaser.Cache.BaseCache;
	atlasCache: Phaser.Cache.BaseCache;

	constructor (scene: Phaser.Scene, pluginManager: Phaser.Plugins.PluginManager, pluginKey: string) {
		super(scene, pluginManager, pluginKey);
		var game = this.game = pluginManager.game;
		this.isWebGL = this.game.config.renderType === 2;
		this.gl = this.isWebGL ? (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl : null;
		this.textureManager = this.game.textures;
		this.phaserRenderer = this.game.renderer;
		this.webGLRenderer = null;
		this.canvasRenderer = null;
		this.skeletonDataCache = this.game.cache.addCustom(SPINE_SKELETON_DATA_CACHE_KEY);
		this.atlasCache = this.game.cache.addCustom(SPINE_ATLAS_CACHE_KEY);

		if (!this.phaserRenderer) {
			this.phaserRenderer = {
				width: game.scale.width,
				height: game.scale.height,
				preRender: () => { },
				postRender: () => { },
				render: () => { },
				destroy: () => { }
			} as unknown as Phaser.Renderer.Canvas.CanvasRenderer;
		}

		let skeletonJsonFileCallback = function (this: any, key: string,
			url: string,
			xhrSettings: Phaser.Types.Loader.XHRSettingsObject) {
			let file = new SpineSkeletonDataFile(this as any, key, url, SpineSkeletonDataFileType.json, xhrSettings);
			this.addFile(file.files);
			return this;
		};
		pluginManager.registerFileType("spineJson", skeletonJsonFileCallback, scene);


		let skeletonBinaryFileCallback = function (this: any, key: string,
			url: string,
			xhrSettings: Phaser.Types.Loader.XHRSettingsObject) {
			let file = new SpineSkeletonDataFile(this as any, key, url, SpineSkeletonDataFileType.binary, xhrSettings);
			this.addFile(file.files);
			return this;
		};
		pluginManager.registerFileType("spineBinary", skeletonBinaryFileCallback, scene);


		let atlasFileCallback = function (this: any, key: string,
			url: string,
			premultipliedAlpha: boolean,
			xhrSettings: Phaser.Types.Loader.XHRSettingsObject) {
			let file = new SpineAtlasFile(this as any, key, url, premultipliedAlpha, xhrSettings);
			this.addFile(file.files);
			return this;
		};
		pluginManager.registerFileType("spineAtlas", atlasFileCallback, scene);

		let self = this;
		let addSpineGameObject = function (this: Phaser.GameObjects.GameObjectFactory, x: number, y: number, dataKey: string, atlasKey: string, boundsProvider: SpineGameObjectBoundsProvider) {
			let gameObject = new SpineGameObject(scene, self, x, y, dataKey, atlasKey, boundsProvider);
			this.displayList.add(gameObject);
			this.updateList.add(gameObject);
			return gameObject;
		};

		let makeSpineGameObject = function (this: Phaser.GameObjects.GameObjectFactory, config: any, addToScene: boolean) {
			let x = config.x ? config.x : 0;
			let y = config.y ? config.y : 0;
			let dataKey = config.dataKey ? config.dataKey : null;
			let atlasKey = config.atlasKey ? config.atlasKey : null;
			let boundsProvider = config.boundsProvider ? config.boundsProvider : undefined;
			let gameObject = new SpineGameObject(this.scene, self, x, y, dataKey, atlasKey, boundsProvider);
			if (addToScene !== undefined) {
				config.add = addToScene;
			}
			return Phaser.GameObjects.BuildGameObject(this.scene, gameObject, config);
		}
		pluginManager.registerGameObject(SPINE_GAME_OBJECT_TYPE, addSpineGameObject, makeSpineGameObject);
	}

	boot () {
		Skeleton.yDown = true;
		if (this.isWebGL) {
			if (!this.webGLRenderer) {
				this.webGLRenderer = new SceneRenderer((this.phaserRenderer! as Phaser.Renderer.WebGL.WebGLRenderer).canvas, this.gl!, true);
			}
			this.onResize();
			this.game.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
		} else {
			if (!this.canvasRenderer) {
				this.canvasRenderer = new SkeletonRenderer(this.scene!.sys.context);
			}
		}

		var eventEmitter = this.systems!.events;
		eventEmitter.once('shutdown', this.shutdown, this);
		eventEmitter.once('destroy', this.destroy, this);
		this.game.events.once('destroy', this.gameDestroy, this);
	}

	onResize () {
		var phaserRenderer = this.phaserRenderer;
		var sceneRenderer = this.webGLRenderer;

		if (phaserRenderer && sceneRenderer) {
			var viewportWidth = phaserRenderer.width;
			var viewportHeight = phaserRenderer.height;
			sceneRenderer.camera.position.x = viewportWidth / 2;
			sceneRenderer.camera.position.y = viewportHeight / 2;
			sceneRenderer.camera.up.y = -1;
			sceneRenderer.camera.direction.z = 1;
			sceneRenderer.camera.setViewport(viewportWidth, viewportHeight);
		}
	}

	shutdown () {
		this.systems!.events.off("shutdown", this.shutdown, this);
		if (this.isWebGL) {
			this.game.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
		}
	}

	destroy () {
		this.shutdown()
	}

	gameDestroy () {
		this.pluginManager.removeGameObject(SPINE_GAME_OBJECT_TYPE, true, true);
		this.pluginManager.removeGameObject(SPINE_CONTAINER_TYPE, true, true);
		if (this.webGLRenderer) this.webGLRenderer.dispose();
	}

	isAtlasPremultiplied (atlasKey: string) {
		let atlasFile = this.game.cache.text.get(atlasKey);
		if (!atlasFile) return false;
		return atlasFile.premultipliedAlpha;
	}

	createSkeleton (dataKey: string, atlasKey: string) {
		let atlas: TextureAtlas;
		if (this.atlasCache.exists(atlasKey)) {
			atlas = this.atlasCache.get(atlasKey);
		} else {
			let atlasFile = this.game.cache.text.get(atlasKey) as { data: string, premultipliedAlpha: boolean };
			atlas = new TextureAtlas(atlasFile.data);
			if (this.isWebGL) {
				let gl = this.gl!;
				gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
				for (let atlasPage of atlas.pages) {
					atlasPage.setTexture(new GLTexture(gl, this.textureManager.get(atlasKey + "!" + atlasPage.name).getSourceImage() as HTMLImageElement | ImageBitmap, false));
				}
			} else {
				for (let atlasPage of atlas.pages) {
					atlasPage.setTexture(new CanvasTexture(this.textureManager.get(atlasKey + "!" + atlasPage.name).getSourceImage() as HTMLImageElement | ImageBitmap));
				}
			}
			this.atlasCache.add(atlasKey, atlas);
		}

		let skeletonData: SkeletonData;
		if (this.skeletonDataCache.exists(dataKey)) {
			skeletonData = this.skeletonDataCache.get(dataKey);
		} else {
			if (this.game.cache.json.exists(dataKey)) {
				let jsonFile = this.game.cache.json.get(dataKey) as any;
				let json = new SkeletonJson(new AtlasAttachmentLoader(atlas));
				skeletonData = json.readSkeletonData(jsonFile);
			} else {
				let binaryFile = this.game.cache.binary.get(dataKey) as ArrayBuffer;
				let binary = new SkeletonBinary(new AtlasAttachmentLoader(atlas));
				skeletonData = binary.readSkeletonData(new Uint8Array(binaryFile));
			}
			this.skeletonDataCache.add(dataKey, skeletonData);
		}

		return new Skeleton(skeletonData);
	}
}

export enum SpineSkeletonDataFileType {
	json,
	binary
}

export class SpineSkeletonDataFile extends Phaser.Loader.MultiFile {
	constructor (loader: Phaser.Loader.LoaderPlugin, key: string, url: string, public fileType: SpineSkeletonDataFileType, xhrSettings: Phaser.Types.Loader.XHRSettingsObject) {
		let file = null;
		let isJson = fileType == SpineSkeletonDataFileType.json;
		if (isJson) {
			file = new Phaser.Loader.FileTypes.JSONFile(loader, {
				key: key,
				url: url,
				extension: "json",
				xhrSettings: xhrSettings,
			} as Phaser.Types.Loader.FileTypes.JSONFileConfig);
		} else {
			file = new Phaser.Loader.FileTypes.BinaryFile(loader, {
				key: key,
				url: url,
				extension: "skel",
				xhrSettings: xhrSettings,
			} as Phaser.Types.Loader.FileTypes.BinaryFileConfig);
		}
		super(loader, SPINE_SKELETON_DATA_FILE_TYPE, key, [file]);
	}

	onFileComplete (file: Phaser.Loader.File) {
		this.pending--;
	}

	addToCache () {
		if (this.isReadyToProcess()) this.files[0].addToCache();
	}
}

export class SpineAtlasFile extends Phaser.Loader.MultiFile {
	constructor (loader: Phaser.Loader.LoaderPlugin, key: string, url: string, public premultipliedAlpha: boolean = true, xhrSettings: Phaser.Types.Loader.XHRSettingsObject) {
		super(loader, SPINE_ATLAS_FILE_TYPE, key, [
			new Phaser.Loader.FileTypes.TextFile(loader, {
				key: key,
				url: url,
				xhrSettings: xhrSettings,
				extension: "atlas"
			})
		]);
	}

	onFileComplete (file: Phaser.Loader.File) {
		if (this.files.indexOf(file) != -1) {
			this.pending--;

			if (file.type == "text") {
				var lines = file.data.split('\n');
				let textures = [];
				textures.push(lines[0]);
				for (var t = 1; t < lines.length; t++) {
					var line = lines[t];
					if (line.trim() === '' && t < lines.length - 1) {
						line = lines[t + 1];
						textures.push(line);
					}
				}

				let basePath = file.src.match(/^.*\//);
				for (var i = 0; i < textures.length; i++) {
					var url = basePath + textures[i];
					var key = file.key + "!" + textures[i];
					var image = new Phaser.Loader.FileTypes.ImageFile(this.loader, key, url);

					if (!this.loader.keyExists(image)) {
						this.addToMultiFile(image);
						this.loader.addFile(image);
					}
				}
			}
		}
	}

	addToCache () {
		if (this.isReadyToProcess()) {
			let textureManager = this.loader.textureManager;
			for (let file of this.files) {
				if (file.type == "image") {
					if (!textureManager.exists(file.key)) {
						textureManager.addImage(file.key, file.data);
					}
				} else {
					file.data = {
						data: file.data,
						premultipliedAlpha: this.premultipliedAlpha || file.data.indexOf("pma: true") >= 0
					};
					file.addToCache();
				}
			}
		}
	}
}