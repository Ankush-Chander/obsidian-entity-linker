import {
	App,
	Editor,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	SuggestModal, TAbstractFile,
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
}

const DEFAULT_SETTINGS: EntityLinkerSettings = {
	mySetting: 'default',
	entityFolder: '',
	politeEmail: ''
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
		let property_string = "---\n"
		for (const [key, value] of Object.entries(entity)) {
			if (typeof (value) == "string") {
				property_string += key + ": " + value + "\n"

			} else if (typeof (value) == "object") {
				// const suffix = key == "ids" ? "_id" : ""
				for (const [key2, value2] of Object.entries(value)) {
					property_string += key2 + ": " + value2 + "\n"
				}
			}
		}
		property_string += "\n---\n"
		// console.log(property_string)
		return property_string
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
				return {displayName: result.display_name, description: result.description, ids: result.ids}
			})
			callback(entity_suggestions)
		})
	}

	async onload() {
		await this.loadSettings();
		this.addCommand({
			id: 'search-entity-command',
			name: 'Search entity',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const search_term = editor.getSelection();
				// editor.replaceSelection('Sample Editor Command');
				this.fetchEntities(search_term, (entity_suggestions) => {
					const emodal = new EntitySuggestionModal(this.app, entity_suggestions, (result: Entity) => {
						// console.log(result)
						const property_string = this.generatePropertiesFromEntity(result)
						// console.log(this.settings)
						this.app.vault.create(this.settings.entityFolder + "/" + result.displayName + ".md", property_string).then(value => {
							// console.log(value)
							this.app.workspace.getLeaf('tab').openFile(value)
						}, error => {
							console.log(error)
						})

					})
					emodal.setPlaceholder(search_term);
					emodal.open()
				})
			}
		});

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
			.setName("Polite Email")
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
	}
}
