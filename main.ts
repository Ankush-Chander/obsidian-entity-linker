import {
	App,
	Editor,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	SuggestModal, TAbstractFile, TFile,
} from 'obsidian';


import {FileSuggestionComponent} from "obsidian-file-suggestion-component";

// create ids interface
interface Ids {
	mag: string;
	openalex: string
	wikidata: string
	wikipedia: string
	umls_cui: object

}

interface Entity {
	displayName: string;
	description: string;
	ids: Ids
}

interface EntityLinkerSettings {
	mySetting: string;
	entityFolder: string
	politeEmail: string
	overwriteFlag: boolean
}

const DEFAULT_SETTINGS: EntityLinkerSettings = {
	mySetting: 'default',
	entityFolder: '',
	politeEmail: '',
	overwriteFlag: false
}

export class EntitySuggestionModal extends SuggestModal<Entity> {
	// Returns all available suggestions.
	entities: Entity[];
	result: object
	onSubmit: (result: object) => void;

	constructor(app: App, headings: Entity[], onSubmit: (result: object) => void) {
		super(app);
		this.entities = headings;
		this.onSubmit = onSubmit;

	}

	onOpen() {
		// console.log("inside onOpen");
		super.onOpen();
	}

	getSuggestions(query: string): Entity[] {
		return this.entities.filter((item) =>
			item.displayName.toLowerCase().includes(query.toLowerCase())
		);
	}

	// Renders each suggestion item.
	renderSuggestion(entity: Entity, el: HTMLElement) {
		el.createEl("div", {text: entity.displayName});
		el.createEl("small", {text: entity.description ? entity.description : ""});
	}


	onChooseSuggestion(entity: Entity, evt: MouseEvent | KeyboardEvent) {
		this.onSubmit(entity);
	}
}

export default class EntityLinker extends Plugin {
	settings: EntityLinkerSettings;

	async userAction(url: any, callback: (arg0: any) => void) {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		});
		const result = await response.json();
		callback(result)
	}

	generatePropertiesFromEntity(entity: Entity) {
		const entity_props: { [key: string]: any } = {};

		for (const [key, value] of Object.entries(entity)) {
			if (typeof (value) == "string" || Array.isArray(value)) {
				entity_props[key] = value
				// property_string += key + ": " + value + "\n"
			} else if (typeof (value) == "object") {
				// const suffix = key == "ids" ? "_id" : ""
				for (const [key2, value2] of Object.entries(value)) {
					entity_props[key2] = value2 //property_string += key2 + ": " + value2 + "\n"
				}
			}
		}
		return entity_props
	}

	isValidEmail(email: string) {
		return /\S+@\S+\.\S+/.test(email);
	}

	fetchEntities(search_term: string, callback: (arg0: any) => void) {
		let base_url = "https://api.openalex.org/concepts?"
		if (this.settings.politeEmail != "" && this.isValidEmail(this.settings.politeEmail)) {
			base_url += "mailto=" + this.settings.politeEmail + "&"
		}
		this.userAction(base_url + "search=" + search_term, (response) => {
			// console.log(response)
			const results = response.results
			const entity_suggestions = results.map((result: any) => {
				return {
					"wikidata entity id": result.ids.wikidata.split("/").last(),
					displayName: result.display_name,
					description: result.description,
					ids: result.ids
				}
			})
			callback(entity_suggestions)
		})
	}

	async updateFrontMatter(file: TAbstractFile, entity_props: object, callback: () => void) {
		console.log(typeof file)
		const overwrite_flag = this.settings.overwriteFlag
		if (file instanceof TFile) {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				// set property if it doesn't exist or if overwrite flag is set
				console.log(frontmatter)
				for (const [key, value] of Object.entries(entity_props)) {
					if (!frontmatter.hasOwnProperty(key) || overwrite_flag) {
						frontmatter[key] = value
					}
				}
				console.log(frontmatter)
				callback()
			})
		}
	}

	entitySearchCallback(search_term: string, open_new_tab = true) {
		this.fetchEntities(search_term, (entity_suggestions) => {
			const emodal = new EntitySuggestionModal(this.app, entity_suggestions, (result: Entity) => {
				// console.log(result)
				const entity_props = this.generatePropertiesFromEntity(result)
				// console.log(this.settings)
				const path = this.settings.entityFolder + "/" + result.displayName + ".md"

				// eslint-disable-next-line
				let entity_file = this.app.vault.getFileByPath(path)
				if (!entity_file) {
					console.log("file not found: " + path)
					// @ts-ignore
					this.app.vault.create(this.settings.entityFolder + "/" + result.displayName + ".md", "").then((new_file) => {
							this.updateFrontMatter(new_file, entity_props, () => {
								if (open_new_tab) {
									this.app.workspace.getLeaf('tab').openFile(new_file)
								}
							})
						},
						() => {
							console.log("failed to create file")
						})
				} else {
					this.updateFrontMatter(entity_file, entity_props, () => {
						if (open_new_tab) {
							// @ts-ignore
							this.app.workspace.getLeaf('tab').openFile(entity_file)
						}
					})


				}
			})
			emodal.setPlaceholder(search_term);
			emodal.open()
		})
	}

	async onload() {
		await this.loadSettings();
		this.addCommand({
			id: 'link-selection-command',
			name: 'Link selection to entity',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const search_term = editor.getSelection()?.toString();
				this.entitySearchCallback(search_term)
			}
		});

		this.addCommand({
			id: 'link-active-note-command',
			name: 'Link active note to entity',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const search_term = this.app.workspace.getActiveFile()?.basename.toString();
				// console.log(search_term)
				if (!search_term) {
					return
				}
				this.entitySearchCallback(search_term, false)
			}
		});

		// bind click event to active note
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				menu.addItem((item) => {
					item
						.setTitle("Link selection to entity")
						.setIcon("document")
						.onClick(async () => {
							const search_term = editor.getSelection();
							this.entitySearchCallback(search_term)
						});

				})

			}))
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				menu.addItem((item) => {
					item
						.setTitle("Link active note to entity")
						.setIcon("document")
						.onClick(async () => {
							const search_term = this.app.workspace.getActiveFile()?.basename.toString();
							// console.log(search_term)
							if (!search_term) {
								return
							}
							this.entitySearchCallback(search_term, false)
						});

				})

			}))

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new EntityLinkerSettingsTab(this.app, this));

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}


class EntityLinkerSettingsTab extends PluginSettingTab {
	plugin: EntityLinker;

	constructor(app: App, plugin: EntityLinker) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Polite email")
			.setDesc("Adding email to openalex API requests(for faster and more consistent response times)")
			.addText((text) =>
				text
					.setPlaceholder("Enter email here")
					.setValue(this.plugin.settings.politeEmail)
					.onChange(async (value) => {
						this.plugin.settings.politeEmail = value;
						await this.plugin.saveSettings();
					}));

		const saveLoc = new Setting(containerEl)
			.setName('Entity folder')
			.setDesc('Folder to store entities');

		new FileSuggestionComponent(saveLoc.controlEl, this.app)
			.setValue(this.plugin.settings.entityFolder)
			.setPlaceholder(DEFAULT_SETTINGS.entityFolder)
			.setFilter("folder")
			.setLimit(10)
			.onSelect(async (val: TAbstractFile) => {
				this.plugin.settings.entityFolder = val.path;
				await this.plugin.saveSettings();
			});

		new Setting(containerEl)
			.setName("Overwrite existing properties")
			.setDesc("If checked, existing properties will be overwritten")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.overwriteFlag)
					.onChange(async (value) => {
						this.plugin.settings.overwriteFlag = value;
						await this.plugin.saveSettings();
					}));
	}
}
