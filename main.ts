import {
	App,
	Editor,
	MarkdownView,
	Plugin,
	PluginSettingTab, requestUrl,
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
	display_name: string;
	hint: string
	description: string;
	ids: Ids
	"wikidata entity id": string
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
	search_term: string
	polite_email: string
	onSubmit: (result: object) => void;
	private debouncedGetSuggestions: any;

	constructor(app: App, search_term: string, polite_email: string, onSubmit: (result: object) => void) {
		super(app);
		this.polite_email = polite_email
		this.search_term = search_term
		this.onSubmit = onSubmit;
		this.debouncedGetSuggestions = this.debounce(this.getSuggestionsImpl, 500);
	}

	onOpen() {
		super.onOpen();
		// workaround to populate input in case text selected in editor
		if (this.search_term) {
			this.inputEl.value = this.search_term;
			this.inputEl.dispatchEvent(new InputEvent("input"));
		}
	}

	debounce(func: { (query: string): Promise<any>; apply?: any; }, wait: number | undefined) {
		let timeout: string | number | NodeJS.Timeout | undefined;
		return function (...args: any) {
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			const context = this;
			clearTimeout(timeout);
			return new Promise((resolve) => {
				timeout = setTimeout(() => resolve(func.apply(context, args)), wait);
			});
		};
	}

	isValidEmail(email: string) {
		return /\S+@\S+\.\S+/.test(email);
	}

	async getSuggestions(query: string) {
		if (!query) {
			return []
		}

		let results = await this.debouncedGetSuggestions(query)
		// console.log(results)
		results = results.map((result: any) => {
			return {
				display_name: result.display_name,
				hint: result.hint,
				ids: {"openalex": result.id.split("/").last()}
			}
		})
		if (results.length == 0) {
			const empty_result = {
				display_name: query,
				hint: "Create empty note"
			}
			return [empty_result]
		}
		return results
	}


	async getSuggestionsImpl(query: string) {
		let url = "https://api.openalex.org/autocomplete/concepts?q=" + query
		if (this.polite_email && this.isValidEmail(this.polite_email)) {
			url += "&mailto=" + this.polite_email
		}
		const response = await requestUrl({
			url: url,
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		})
		const res = response.json
		return res.results
	}

	// Renders each suggestion item.
	renderSuggestion(entity: Entity, el: HTMLElement) {
		el.createEl("div", {text: entity.display_name});
		el.createEl("small", {text: entity.hint ? entity.hint : ""});
	}

	async getRedirectedUrl(url: string) {
		const response = await requestUrl({
			"url": url,
			"method": "GET",
			"headers": {
				"Content-Type": "text/html"
			}
		})

		const html_content = response.text
		const el = document.createElement('html');
		el.innerHTML = html_content;
		const canonical_link = el.querySelector('link[rel="canonical"]');

		// Get the href attribute
		const href_value = canonical_link ? canonical_link.getAttribute('href') : null;
		return href_value
	}

	async generatePropertiesFromEntity(entity: Entity) {
		if (!entity.hasOwnProperty("ids")) {
			const wiki_search_url = "https://en.wikipedia.org/wiki/Special:Search?go=Go&search=" + encodeURIComponent(entity.display_name);
			const redirect_url = await this.getRedirectedUrl(wiki_search_url);
			const empty_result = {
				display_name: entity.display_name,
				description: "",
				wikipedia: redirect_url ? redirect_url : wiki_search_url,
				wikidata: "https://www.wikidata.org/w/index.php?search=" + encodeURIComponent(entity.display_name)
			}
			return empty_result
		}

		let concept_url = "https://api.openalex.org/concepts/" + entity.ids.openalex
		if (this.polite_email && this.isValidEmail(this.polite_email)) {
			concept_url += "?mailto=" + this.polite_email
		}

		const response = await requestUrl({
			url: concept_url,
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		})
		const entity_result = response.json

		const entity_props: { [key: string]: any } = {};
		const properties_of_interest = ["wikidata entity id", "display_name", "description", "ids"]
		for (const [key, value] of Object.entries(entity_result)) {
			if (!properties_of_interest.includes(key)) {
				continue
			}
			if (typeof value == "string" || Array.isArray(value)) {
				entity_props[key] = value
				// property_string += key + ": " + value + "\n"
			} else if (value && typeof (value) == "object") {
				for (const [key2, value2] of Object.entries(value)) {
					entity_props[key2] = value2 //property_string += key2 + ": " + value2 + "\n"
				}
			}
		}


		entity_props["wikidata entity id"] = entity_props["wikidata"] ? entity_props["wikidata"].split("/").last() : ""
		// console.log(entity_props)
		return entity_props
	}

	async onChooseSuggestion(entity: Entity, evt: MouseEvent | KeyboardEvent) {
		// fetch concept properties
		const entity_props = await this.generatePropertiesFromEntity(entity)
		this.onSubmit(entity_props)
	}
}

export default class EntityLinker extends Plugin {
	settings: EntityLinkerSettings;


	async updateFrontMatter(file: TAbstractFile, entity_props: object, callback: () => void) {
		const overwrite_flag = this.settings.overwriteFlag
		if (file instanceof TFile) {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				// set property if it doesn't exist or if overwrite flag is set
				// console.log(frontmatter)
				for (const [key, value] of Object.entries(entity_props)) {
					if (!frontmatter.hasOwnProperty(key) || overwrite_flag) {
						frontmatter[key] = value
					}
				}
				callback()
			})
		}
	}

	async entitySearchCallback(search_term: string, open_new_tab = true) {
		const polite_email = this.settings.politeEmail
		const emodal = new EntitySuggestionModal(this.app, search_term, polite_email, async (result: Entity) => {
			const path = this.settings.entityFolder + "/" + result.display_name + ".md"
			// eslint-disable-next-line
			let entity_file = this.app.vault.getFileByPath(path)
			if (!entity_file) {
				// @ts-ignore
				const new_file = await this.app.vault.create(this.settings.entityFolder + "/" + result.display_name + ".md", "")
				if (!new_file) {
					console.error("failed to create file")
					return
				}
				this.updateFrontMatter(new_file, result, () => {
					if (open_new_tab) {
						this.app.workspace.getLeaf('tab').openFile(new_file)
					}
				})
			} else {
				this.updateFrontMatter(entity_file, result, () => {
					if (open_new_tab) {
						// @ts-ignore
						this.app.workspace.getLeaf('tab').openFile(entity_file)
					}
				})
			}
		})
		emodal.open()

	}

	async onload() {
		await this.loadSettings();
		this.addCommand({
			id: 'link-selection',
			name: 'Link selection to entity',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const search_term = editor.getSelection()?.toString();
				await this.entitySearchCallback(search_term)
			}
		});

		this.addCommand({
			id: 'link-active-note',
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
