import {
	App,
	Editor,
	EditorPosition,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab, requestUrl,
	Setting,
	SuggestModal, TAbstractFile, TFile,
} from 'obsidian';

import * as _ from 'lodash';

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
	conceptFolder: string
	politeEmail: string
	overwriteFlag: boolean
	insertLinkOnSelection: boolean
	addAliases: boolean
}

const DEFAULT_SETTINGS: EntityLinkerSettings = {
	mySetting: 'default',
	entityFolder: '',
	conceptFolder: '',
	politeEmail: '',
	overwriteFlag: false,
	insertLinkOnSelection: true,
	addAliases: true
}

// Characters Obsidian disallows in file names, plus the ones that break wikilinks.
const ILLEGAL_FILENAME_CHARS = /[*"\\/<>:|?#^[\]]/g;

function sanitizeFileName(name: string): string {
	return name.replace(ILLEGAL_FILENAME_CHARS, " ").replace(/\s+/g, " ").trim();
}

function isEmptyValue(value: unknown): boolean {
	if (value === null || value === undefined) {
		return true
	}
	if (typeof value === "string") {
		return value.trim() === ""
	}
	if (Array.isArray(value)) {
		return value.length === 0
	}
	return false
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
			const wiki_result = await this.getWikiDataFromSearchTerm(query)
			return [wiki_result]
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

	async getWikiDataFromSearchTerm(search_term: string) {
		const wiki_search_url = "https://en.wikipedia.org/wiki/Special:Search?go=Go&search=" + encodeURIComponent(search_term);
		const wikidata_search_url = "https://www.wikidata.org/w/index.php?search=" + encodeURIComponent(search_term)

		const response = await requestUrl({
			"url": wiki_search_url,
			"method": "GET",
			"headers": {
				"Content-Type": "text/html"
			}
		})

		const html_content = response.text
		const el = document.createElement('html');
		el.innerHTML = html_content;
		const scriptTag = el.querySelector('script[type="application/ld+json"]');
		if (scriptTag) {
			// Get the text content of the script tag
			const jsonContent = scriptTag.textContent;
			try {
				// Parse the JSON content
				const json_data = jsonContent ? JSON.parse(jsonContent) : null;
				// console.log('Extracted JSON:', json_data);

				const entity = {
					display_name: json_data.hasOwnProperty("name") ? json_data.name : search_term,
					wikipedia: json_data.hasOwnProperty("url") ? json_data.url : wiki_search_url,
					wikidata: json_data.hasOwnProperty("mainEntity") ? json_data.mainEntity : wikidata_search_url,
					"wikidata entity id": json_data.hasOwnProperty("mainEntity") ? json_data.mainEntity.split("/").last() : "",
					description: json_data.hasOwnProperty("headline") ? json_data.headline : "",
					hint: json_data.hasOwnProperty("headline") ? json_data.headline : ""
				}
				return entity;
			} catch (error) {
				console.error('Error parsing JSON:', error);
			}
		} else {
			// console.error(search_term + ': No script tag with type "application/ld+json" found.');
		}
		return {
			display_name: search_term,
			wikipedia: wiki_search_url,
			wikidata: wikidata_search_url,
			description: "",
			"wikidata entity id": "",
			hint: "Create empty note"
		};
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
			return entity
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


interface EntityProps {
// ["display_name", "description", "openalex", "wikidata", "mag", "wikipedia", "umls_cui",
// 				"wikidata entity id"]
	display_name: string
	description: string
	"openalex": string
	wikidata: string
	wikipedia: string
	umls_cui: string
	"mag": string
	"wikidata entity id": string
	"hint"?: string
}

/**
 * Where the result of a lookup should land.
 *
 * `targetFile` annotates an existing note in place (active-note mode) and never
 * creates anything. Otherwise the note is resolved-or-created in the folder the
 * result's provenance routes to, and, when an editor range is supplied, the
 * selection is replaced with a link to it.
 */
interface LinkContext {
	targetFile?: TFile | null
	editor?: Editor
	range?: { from: EditorPosition, to: EditorPosition }
	sourcePath?: string
}

export default class EntityLinker extends Plugin {
	settings: EntityLinkerSettings;


	async updateFrontMatter(file: TAbstractFile, entity_props: object, aliases: string[] = []) {
		const overwrite_flag = this.settings.overwriteFlag
		if (!(file instanceof TFile)) {
			return
		}

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			// set property if it doesn't exist or if overwrite flag is set
			for (const [key, value] of Object.entries(entity_props)) {
				// never write blanks: an unresolved id should leave no property behind
				if (isEmptyValue(value)) {
					continue
				}
				// a blank existing property carries no information, so filling it is
				// not an overwrite - this heals notes left with empty ids by earlier versions
				if (!frontmatter.hasOwnProperty(key) || isEmptyValue(frontmatter[key]) || overwrite_flag) {
					frontmatter[key] = value
				}
			}

			// aliases are additive rather than overwritten, so hand-added ones survive
			if (this.settings.addAliases && aliases.length) {
				const existing: string[] = Array.isArray(frontmatter.aliases)
					? frontmatter.aliases
					: (typeof frontmatter.aliases === "string" && frontmatter.aliases ? [frontmatter.aliases] : [])
				const merged = [...existing]
				for (const alias of aliases) {
					if (!merged.some((a) => String(a).toLowerCase() === alias.toLowerCase())) {
						merged.push(alias)
					}
				}
				if (merged.length) {
					frontmatter.aliases = merged
				}
			}
		})
	}

	/**
	 * OpenAlex hits carry an `openalex` id and are scholarly concepts; the
	 * Wikipedia/Wikidata fallback only fires for everything else, which is where
	 * named entities come from. Route each to its own folder, falling back to the
	 * entity folder so existing single-folder setups keep working.
	 */
	resolveFolder(entity_props: Partial<EntityProps>): string {
		const is_concept = Boolean(entity_props.openalex)
		if (is_concept && this.settings.conceptFolder) {
			return this.settings.conceptFolder
		}
		return this.settings.entityFolder
	}

	async ensureFolder(folder_path: string) {
		if (!folder_path) {
			return
		}
		if (this.app.vault.getAbstractFileByPath(folder_path)) {
			return
		}
		try {
			await this.app.vault.createFolder(folder_path)
		} catch (error) {
			// folder created concurrently, or an illegal path - creation below will report it
		}
	}

	/**
	 * Look for the note anywhere in the vault before creating one, so a concept
	 * already filed by hand isn't duplicated into the entity folder under a
	 * different casing.
	 */
	findExistingNote(names: string[], source_path: string): TFile | null {
		for (const name of names) {
			if (!name) {
				continue
			}
			const found = this.app.metadataCache.getFirstLinkpathDest(name, source_path)
			if (found) {
				return found
			}
		}
		return null
	}

	async resolveOrCreateNote(entity_props: Partial<EntityProps>, search_term: string, source_path: string) {
		const display_name = entity_props.display_name || search_term
		const file_name = sanitizeFileName(display_name) || sanitizeFileName(search_term)
		if (!file_name) {
			new Notice("Entity Linker: could not derive a file name from this result")
			return null
		}

		const existing = this.findExistingNote([file_name, display_name, search_term], source_path)
		if (existing) {
			return existing
		}

		const folder = this.resolveFolder(entity_props)
		await this.ensureFolder(folder)
		const path = (folder ? folder + "/" : "") + file_name + ".md"
		try {
			return await this.app.vault.create(path, "")
		} catch (error) {
			// most likely the file appeared between the lookup and the create
			const raced = this.app.vault.getAbstractFileByPath(path)
			if (raced instanceof TFile) {
				return raced
			}
			console.error("Entity Linker: failed to create " + path, error)
			new Notice("Entity Linker: failed to create note at " + path)
			return null
		}
	}

	/**
	 * Replace the original selection with a link to `file`. The lookup is async and
	 * the modal is dismissable, so the range is re-verified against the text that
	 * was selected before anything is written.
	 */
	insertLink(file: TFile, context: LinkContext, search_term: string) {
		const {editor, range} = context
		if (!editor || !range) {
			return false
		}
		if (editor.getRange(range.from, range.to) !== search_term) {
			new Notice("Entity Linker: note updated, but the text moved - link not inserted")
			return false
		}
		// keep the prose reading as written when the canonical title differs
		const alias = file.basename.toLowerCase() === search_term.toLowerCase() ? undefined : search_term
		const link = this.app.fileManager.generateMarkdownLink(file, context.sourcePath ?? "", undefined, alias)
		editor.replaceRange(link, range.from, range.to)
		return true
	}

	async entitySearchCallback(search_term: string, context: LinkContext = {}) {
		const polite_email = this.settings.politeEmail
		const emodal = new EntitySuggestionModal(this.app, search_term, polite_email, async (result: EntityProps) => {
			// filter acceptable properties
			const entity_props: Partial<EntityProps> = _.pick(result, ["display_name", "description", "openalex", "wikidata", "mag", "wikipedia", "umls_cui",
				"wikidata entity id"])

			// active-note mode annotates the note you are in; it never creates a file
			if (context.targetFile) {
				const aliases = this.aliasesFor(context.targetFile.basename, entity_props.display_name, search_term)
				await this.updateFrontMatter(context.targetFile, entity_props, aliases)
				new Notice("Entity Linker: linked " + context.targetFile.basename)
				return
			}

			const source_path = context.sourcePath ?? ""
			const note = await this.resolveOrCreateNote(entity_props, search_term, source_path)
			if (!note) {
				return
			}

			const aliases = this.aliasesFor(note.basename, entity_props.display_name, search_term)
			await this.updateFrontMatter(note, entity_props, aliases)

			const linked = this.settings.insertLinkOnSelection && this.insertLink(note, context, search_term)
			if (!linked) {
				// no link to anchor it, so surface the note the way it always did
				this.app.workspace.getLeaf('tab').openFile(note)
			}
		})
		emodal.open()

	}

	/**
	 * Every name that should resolve to this note but isn't its file name -
	 * the canonical title when it was sanitized, and the term actually selected.
	 */
	aliasesFor(basename: string, display_name?: string, search_term?: string): string[] {
		const aliases: string[] = []
		for (const candidate of [display_name, search_term]) {
			if (!candidate) {
				continue
			}
			const trimmed = candidate.trim()
			if (!trimmed || trimmed.toLowerCase() === basename.toLowerCase()) {
				continue
			}
			if (!aliases.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
				aliases.push(trimmed)
			}
		}
		return aliases
	}

	linkSelection(editor: Editor, view: MarkdownView) {
		const search_term = editor.getSelection()?.toString();
		if (!search_term) {
			new Notice("Entity Linker: select some text first")
			return
		}
		// capture the range now - the modal is async and the cursor will move
		this.entitySearchCallback(search_term, {
			editor: editor,
			range: {from: editor.getCursor("from"), to: editor.getCursor("to")},
			sourcePath: view.file?.path ?? ""
		})
	}

	linkActiveNote(view: MarkdownView) {
		const file = view.file ?? this.app.workspace.getActiveFile();
		if (!file) {
			return
		}
		this.entitySearchCallback(file.basename.toString(), {targetFile: file, sourcePath: file.path})
	}

	async onload() {
		await this.loadSettings();
		this.addCommand({
			id: 'link-selection',
			name: 'Link selection to entity',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.linkSelection(editor, view)
			}
		});

		this.addCommand({
			id: 'link-active-note',
			name: 'Link active note to entity',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.linkActiveNote(view)
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
							this.linkSelection(editor, view as MarkdownView)
						});

				})
				menu.addItem((item) => {
					item
						.setTitle("Link active note to entity")
						.setIcon("document")
						.onClick(async () => {
							this.linkActiveNote(view as MarkdownView)
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

		const conceptLoc = new Setting(containerEl)
			.setName('Concept folder')
			.setDesc('Folder to store OpenAlex concept hits. Leave empty to keep everything in the entity folder.');

		new FileSuggestionComponent(conceptLoc.controlEl, this.app)
			.setValue(this.plugin.settings.conceptFolder)
			.setPlaceholder(DEFAULT_SETTINGS.conceptFolder)
			.setFilter("folder")
			.setLimit(10)
			.onSelect(async (val: TAbstractFile) => {
				this.plugin.settings.conceptFolder = val.path;
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

		new Setting(containerEl)
			.setName("Insert link at selection")
			.setDesc("Replace the selected text with a link to the entity note instead of opening it in a new tab")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.insertLinkOnSelection)
					.onChange(async (value) => {
						this.plugin.settings.insertLinkOnSelection = value;
						await this.plugin.saveSettings();
					}));

		new Setting(containerEl)
			.setName("Record aliases")
			.setDesc("Add the searched term and canonical name to the note's aliases so both resolve to it")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.addAliases)
					.onChange(async (value) => {
						this.plugin.settings.addAliases = value;
						await this.plugin.saveSettings();
					}));
	}
}
