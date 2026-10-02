/**
 * Vendored from @ng-formworks/core 21.7.0 (fesm2022/ng-formworks-core.mjs,
 * lines 11918-12652: `JsonSchemaFormComponent`, as patched by
 * ui/patches/@ng-formworks+core+21.7.0.patch).
 *
 * The form-lifecycle logic (updateForm / initializeForm / activateForm and
 * friends) is kept line-for-line. What changed:
 * - Angular signal inputs became `this.inputs[name]` (see `getInputValue`);
 * - `output()` emitters became the optional callbacks in `this.events`;
 * - the asset loading (an HTTP request for `assets/<framework>/cssframework/
 *   assets.json` that never loads anything with loadExternalAssets: false),
 *   the ControlValueAccessor plumbing and debug output were dropped;
 * - `FrameworkLibraryService` is reduced to the single active framework.
 *
 * MIT License
 *
 * Copyright (c) 2014-2016 David Schnell-Davis 2018 Hamza Hamidi 2023 Zaheer M
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
// @ts-nocheck
import cloneDeep from 'lodash-es/cloneDeep'
import isEqual$1 from 'lodash-es/isEqual'
import { Subject } from 'rxjs'
import { takeUntil } from 'rxjs/operators'
import { compareObjectArraySizes, forEach, hasOwn, hasValue, inArray, isArray, isEmpty, isObject } from './utility.functions'
import { JsonPointer } from './jsonpointer.functions'
import { convertSchemaToDraft6, resolveSchemaReferences } from './json-schema.functions'
import { JsonSchemaFormService } from './json-schema-form.service'

export const JSON_SCHEMA_FORM_INPUTS = [
  'schema', 'layout', 'data', 'options', 'framework', 'widgets', 'form', 'model', 'JSONSchema',
  'UISchema', 'formData', 'ngModel', 'language', 'loadExternalAssets', 'debug', 'theme', 'ajvOptions',
]

/**
 * Stand-in for formworks' FrameworkLibraryService with exactly one framework
 * registered (the app only ever uses `framework="bootstrap-5"`).
 */
export class FrameworkLibrary {
  constructor(framework, widgetLibrary) {
    this.widgetLibrary = widgetLibrary
    this.activeFramework = framework
    this.loadExternalAssets = false
  }
  setLoadExternalAssets(loadExternalAssets = true) {
    this.loadExternalAssets = !!loadExternalAssets
  }
  setFramework() {
    return hasOwn(this.activeFramework, 'widgets') ?
      this.widgetLibrary.registerFrameworkWidgets(this.activeFramework.widgets) :
      this.widgetLibrary.unRegisterFrameworkWidgets()
  }
  getFramework() {
    return this.activeFramework.framework
  }
  getFrameworkConfig() {
    return this.activeFramework.config
  }
  requestThemeChange() {}
  getActiveTheme() {
    return this.activeFramework.config?.widgetstyles?.__themes__?.[0]
  }
}

export class JsonSchemaFormController {
  constructor(frameworkLibrary, widgetLibrary, events = {}) {
    this.frameworkLibrary = frameworkLibrary;
    this.widgetLibrary = widgetLibrary;
    this.events = events;
    this.jsf = new JsonSchemaFormService();
    this.inputs = {};
    // TODO: quickfix to avoid subscribing twice to the same emitters
    this.unsubscribeOnActivateForm$ = new Subject();
    this.formValueSubscription = null;
    this.formInitialized = false;
    this.objectWrap = false; // Is non-object input schema wrapped in an object?
    this.previousInputs = {
      schema: null, layout: null, data: null, options: null, framework: null,
      widgets: null, form: null, model: null, JSONSchema: null, UISchema: null,
      formData: null, loadExternalAssets: null, debug: null, ajvOptions: null
    };
  }
  // Signal-input stand-ins
  schema() { return this.inputs.schema; }
  layout() { return this.inputs.layout; }
  data() { return this.inputs.data; }
  options() { return this.inputs.options; }
  framework() { return this.inputs.framework; }
  widgets() { return this.inputs.widgets; }
  form() { return this.inputs.form; }
  model() { return this.inputs.model; }
  JSONSchema() { return this.inputs.JSONSchema; }
  UISchema() { return this.inputs.UISchema; }
  formData() { return this.inputs.formData; }
  ngModel() { return this.inputs.ngModel; }
  language() { return this.inputs.language; }
  loadExternalAssets() { return this.inputs.loadExternalAssets; }
  debug() { return this.inputs.debug; }
  theme() { return this.inputs.theme; }
  ajvOptions() { return this.inputs.ajvOptions; }
  emit(name, value) {
    const handler = this.events[name];
    if (typeof handler === 'function') {
      handler(value);
    }
  }
  get value() {
    return this.objectWrap ? this.jsf.data['1'] : this.jsf.data;
  }
  set value(value) {
    this.setFormValues(value, false);
  }
  destroy() {
    this.unsubscribeOnActivateForm$.next();
    this.dataChangesSubs?.unsubscribe();
    this.statusChangesSubs?.unsubscribe();
    this.isValidChangesSubs?.unsubscribe();
    this.validationErrorChangesSubs?.unsubscribe();
    this.dataChangesSubs = null;
    this.statusChangesSubs = null;
    this.isValidChangesSubs = null;
    this.validationErrorChangesSubs = null;
    this.jsf.destroy();
  }
  getInputValue(inputKey) {
    //TODO review if the value is meant to be a function and not a signal,
    //it might inadvertently be called!
    if (typeof this[inputKey] == "function") {
      return this[inputKey]();
    }
    return this[inputKey];
  }
  /**
   * Angular's `ngOnInit` / `ngOnChanges` both call `updateForm()`: assign
   * the new input values, then call this.
   */
  setInputs(inputs) {
    this.inputs = { ...inputs };
  }
  updateForm() {
    let changedData;
    const language = this.language();
    if (!this.formInitialized || !this.formValuesInput ||
      (language && language !== this.jsf.language)) {
      this.initializeForm();
    }
    else {
      if (language && language !== this.jsf.language) {
        this.jsf.setLanguage(language);
      }
      // Get names of changed inputs
      let changedInput = Object.keys(this.previousInputs)
        .filter(input => this.previousInputs[input] !== this.getInputValue(input));
      let resetFirst = true;
      if (changedInput.length === 1 && changedInput[0] === 'form' &&
        this.formValuesInput.startsWith('form.')) {
        // If only 'form' input changed, get names of changed keys
        changedInput = Object.keys(this.previousInputs.form || {})
          .filter(key => !isEqual$1(this.previousInputs.form[key], this.form()[key]))
          .map(key => `form.${key}`);
        resetFirst = false;
      }
      // If only input values have changed, update the form values
      if (changedInput.length === 1 && changedInput[0] === this.formValuesInput) {
        if (this.formValuesInput.indexOf('.') === -1) {
          changedData = this.getInputValue(this.formValuesInput);
          //this[this.formValuesInput];
        }
        else {
          const [input, key] = this.formValuesInput.split('.');
          changedData = this.getInputValue(input)[key];
        }
        //TODO -review if any of the the array sizes changed then the
        //layout array sizes need to be resynced to match
        //-for now jsf.adjustLayout doesnt seem to work with nested arrays
        //so entire form is reinited
        let arraySizesChanged = !compareObjectArraySizes(changedData, this.jsf.data);
        if (arraySizesChanged) {
          this.initializeForm(changedData);
          if (this.onChange) {
            this.onChange(changedData);
          }
          if (this.onTouched) {
            this.onTouched(changedData);
          }
        }
        else {
          this.setFormValues(changedData, resetFirst);
        }
        // If anything else has changed, re-render the entire form
      }
      else if (changedInput.length) {
        this.initializeForm(changedData);
        if (this.onChange) {
          this.onChange(this.jsf.formValues);
        }
        if (this.onTouched) {
          this.onTouched(this.jsf.formValues);
        }
      }
      //set framework theme
      const theme = this.theme();
      if (theme && theme !== this.frameworkLibrary.getActiveTheme()?.name) {
        this.frameworkLibrary.requestThemeChange(theme);
      }
      // Update previous inputs
      Object.keys(this.previousInputs)
        .filter(input => this.previousInputs[input] !== this.getInputValue(input))
        .forEach(input => this.previousInputs[input] = this.getInputValue(input));
    }
  }
  setFormValues(formValues, resetFirst = true, emitFormEvent = true, usePatch = true) {
    if (formValues) {
      const newFormValues = this.objectWrap ? formValues['1'] : formValues;
      if (!this.jsf.formGroup) {
        this.jsf.formValues = formValues;
        this.activateForm();
      }
      else if (resetFirst) { //changed to avoid reset events
        this.jsf.formGroup.reset({}, { emitEvent: emitFormEvent });
      }
      if (this.jsf.formGroup) { //changed to avoid reset events
        if (usePatch) {
          this.jsf.formGroup.patchValue(newFormValues, { emitEvent: emitFormEvent });
        }
        else {
          this.jsf.formGroup.setValue(newFormValues, { emitEvent: emitFormEvent });
        }
      }
      if (this.onChange) {
        this.onChange(newFormValues);
      }
      if (this.onTouched) {
        this.onTouched(newFormValues);
      }
    }
    else {
      this.jsf.formGroup.reset();
    }
    this.emit('markForCheck');
  }
  submitForm() {
    const validData = this.jsf.validData;
    this.emit('onSubmit', this.objectWrap ? validData['1'] : validData);
  }
  /**
   * 'initializeForm' function
   *
   * - Update 'schema', 'layout', and 'formValues', from inputs.
   *
   * - Create 'schemaRefLibrary' and 'schemaRecursiveRefMap'
   *   to resolve schema $ref links, including recursive $ref links.
   *
   * - Create 'dataRecursiveRefMap' to resolve recursive links in data
   *   and corectly set output formats for recursively nested values.
   *
   * - Create 'layoutRefLibrary' and 'templateRefLibrary' to store
   *   new layout nodes and formGroup elements to use when dynamically
   *   adding form components to arrays and recursive $ref points.
   *
   * - Create 'dataMap' to map the data to the schema and template.
   *
   * - Create the master 'formGroupTemplate' then from it 'formGroup'
   *   the Angular formGroup used to control the reactive form.
   */
  initializeForm(initialData) {
    if (this.schema() || this.layout() || this.data() || this.form() || this.model() ||
      this.JSONSchema() || this.UISchema() || this.formData() || this.ngModel() ||
      this.jsf.data) {
      // Reset all form values to defaults
      this.jsf.resetAllValues();
      this.initializeAjv();
      this.initializeOptions(); // Update options
      this.initializeSchema(); // Update schema, schemaRefLibrary,
      // schemaRecursiveRefMap, & dataRecursiveRefMap
      this.initializeLayout(); // Update layout, layoutRefLibrary,
      this.initializeData(); // Update formValues
      if (initialData) {
        this.jsf.formValues = initialData;
      }
      this.activateForm(); // Update dataMap, templateRefLibrary,
      // formGroupTemplate, formGroup
      this.formInitialized = true;
    }
  }
  /**
   * 'initializeAjv' function
   *
   * Initialize ajv from 'ajvOptions'
   */
  initializeAjv() {
    const form = this.form();
    const ajvOptions = cloneDeep(this.ajvOptions()) ||
      (form && hasOwn(form, 'ajvOptions') && isObject(form.ajvOptions)
        && cloneDeep(form.ajvOptions));
    if (ajvOptions) {
      this.ajvInstanceName = this.jsf.createAndRegisterAjvInstance(ajvOptions).name;
    }
  }
  /**
   * 'initializeOptions' function
   *
   * Initialize 'options' (global form options) and set framework
   * Combine available inputs:
   * 1. options - recommended
   * 2. form.options - Single input style
   */
  initializeOptions() {
    const language = this.language();
    if (language && language !== this.jsf.language) {
      this.jsf.setLanguage(language);
    }
    this.jsf.setOptions({ debug: !!this.debug() });
    let loadExternalAssets = this.loadExternalAssets() || false;
    let framework = this.framework() || 'default';
    const options = this.options();
    if (isObject(options)) {
      this.jsf.setOptions(options);
      loadExternalAssets = options.loadExternalAssets || loadExternalAssets;
      framework = options.framework || framework;
    }
    const form = this.form();
    if (isObject(form) && isObject(form.options)) {
      this.jsf.setOptions(form.options);
      loadExternalAssets = form.options.loadExternalAssets || loadExternalAssets;
      framework = form.options.framework || framework;
    }
    const widgets = this.widgets();
    if (isObject(widgets)) {
      this.jsf.setOptions({ widgets: widgets });
    }
    this.frameworkLibrary.setLoadExternalAssets(loadExternalAssets);
    this.frameworkLibrary.setFramework(framework);
    this.jsf.framework = this.frameworkLibrary.getFramework();
    if (isObject(this.jsf.formOptions.widgets)) {
      for (const widget of Object.keys(this.jsf.formOptions.widgets)) {
        this.widgetLibrary.registerWidget(widget, this.jsf.formOptions.widgets[widget]);
      }
    }
    if (isObject(form) && isObject(form.tpldata)) {
      this.jsf.setTpldata(form.tpldata);
    }
    const theme = this.theme();
    if (theme) {
      this.frameworkLibrary.requestThemeChange(theme);
    }
  }
  /**
   * 'initializeSchema' function
   *
   * Initialize 'schema'
   * Use first available input:
   * 1. schema - recommended / Angular Schema Form style
   * 2. form.schema - Single input / JSON Form style
   * 3. JSONSchema - React JSON Schema Form style
   * 4. form.JSONSchema - For testing single input React JSON Schema Forms
   * 5. form - For testing single schema-only inputs
   *
   * ... if no schema input found, the 'activateForm' function, below,
   *     will make two additional attempts to build a schema
   * 6. If layout input - build schema from layout
   * 7. If data input - build schema from data
   */
  initializeSchema() {
    // TODO: update to allow non-object schemas
    const form = this.form();
    const schema = this.schema();
    const JSONSchema = this.JSONSchema();
    if (isObject(schema)) {
      this.jsf.AngularSchemaFormCompatibility = true;
      this.jsf.schema = cloneDeep(schema);
    }
    else if (hasOwn(form, 'schema') && isObject(form.schema)) {
      this.jsf.schema = cloneDeep(form.schema);
    }
    else if (isObject(JSONSchema)) {
      this.jsf.ReactJsonSchemaFormCompatibility = true;
      this.jsf.schema = cloneDeep(JSONSchema);
    }
    else if (hasOwn(form, 'JSONSchema') && isObject(form.JSONSchema)) {
      this.jsf.ReactJsonSchemaFormCompatibility = true;
      this.jsf.schema = cloneDeep(form.JSONSchema);
    }
    else if (hasOwn(form, 'properties') && isObject(form.properties)) {
      this.jsf.schema = cloneDeep(form);
    }
    else if (isObject(form)) {
      // TODO: Handle other types of form input
    }
    if (!isEmpty(this.jsf.schema)) {
      // If other types also allowed, render schema as an object
      if (inArray('object', this.jsf.schema.type)) {
        this.jsf.schema.type = 'object';
      }
      // Wrap non-object schemas in object.
      if (hasOwn(this.jsf.schema, 'type') && this.jsf.schema.type !== 'object') {
        this.jsf.schema = {
          'type': 'object',
          'properties': { 1: this.jsf.schema }
        };
        this.objectWrap = true;
      }
      else if (!hasOwn(this.jsf.schema, 'type')) {
        // Add type = 'object' if missing
        if (isObject(this.jsf.schema.properties) ||
          isObject(this.jsf.schema.patternProperties) ||
          isObject(this.jsf.schema.additionalProperties)) {
          this.jsf.schema.type = 'object';
          // Fix JSON schema shorthand (JSON Form style)
        }
        else {
          this.jsf.JsonFormCompatibility = true;
          this.jsf.schema = {
            'type': 'object',
            'properties': this.jsf.schema
          };
        }
      }
      // If needed, update JSON Schema to draft 6 format, including
      // draft 3 (JSON Form style) and draft 4 (Angular Schema Form style)
      this.jsf.schema = convertSchemaToDraft6(this.jsf.schema);
      // Create schemaRefLibrary, schemaRecursiveRefMap, dataRecursiveRefMap, & arrayMap
      this.jsf.schema = resolveSchemaReferences(this.jsf.schema, this.jsf.schemaRefLibrary, this.jsf.schemaRecursiveRefMap, this.jsf.dataRecursiveRefMap, this.jsf.arrayMap);
      if (hasOwn(this.jsf.schemaRefLibrary, '')) {
        this.jsf.hasRootReference = true;
      }
    }
  }
  /**
   * 'initializeData' function
   *
   * Initialize 'formValues'
   * defulat or previously submitted values used to populate form
   * Use first available input:
   * 1. data - recommended
   * 2. model - Angular Schema Form style
   * 3. form.value - JSON Form style
   * 4. form.data - Single input style
   * 5. formData - React JSON Schema Form style
   * 6. form.formData - For easier testing of React JSON Schema Forms
   * 7. (none) no data - initialize data from schema and layout defaults only
   */
  initializeData() {
    const form = this.form();
    const data = this.data();
    const model = this.model();
    const ngModel = this.ngModel();
    if (hasValue(data)) {
      this.jsf.formValues = cloneDeep(data);
      this.formValuesInput = 'data';
    }
    else if (hasValue(model)) {
      this.jsf.AngularSchemaFormCompatibility = true;
      this.jsf.formValues = cloneDeep(model);
      this.formValuesInput = 'model';
    }
    else if (hasValue(ngModel)) {
      this.jsf.AngularSchemaFormCompatibility = true;
      this.jsf.formValues = cloneDeep(ngModel);
      this.formValuesInput = 'ngModel';
    }
    else if (isObject(form) && hasValue(form.value)) {
      this.jsf.JsonFormCompatibility = true;
      this.jsf.formValues = cloneDeep(form.value);
      this.formValuesInput = 'form.value';
    }
    else if (isObject(form) && hasValue(form.data)) {
      this.jsf.formValues = cloneDeep(form.data);
      this.formValuesInput = 'form.data';
    }
    else if (hasValue(this.formData())) {
      this.jsf.ReactJsonSchemaFormCompatibility = true;
      this.formValuesInput = 'formData';
    }
    else if (hasOwn(form, 'formData') && hasValue(form.formData)) {
      this.jsf.ReactJsonSchemaFormCompatibility = true;
      this.jsf.formValues = cloneDeep(form.formData);
      this.formValuesInput = 'form.formData';
    }
    else {
      this.formValuesInput = "data"; //null;
    }
  }
  /**
   * 'initializeLayout' function
   *
   * Initialize 'layout'
   * Use first available array input:
   * 1. layout - recommended
   * 2. form - Angular Schema Form style
   * 3. form.form - JSON Form style
   * 4. form.layout - Single input style
   * 5. (none) no layout - set default layout instead
   *    (full layout will be built later from the schema)
   *
   * Also, if alternate layout formats are available,
   * import from 'UISchema' or 'customFormItems'
   * used for React JSON Schema Form and JSON Form API compatibility
   * Use first available input:
   * 1. UISchema - React JSON Schema Form style
   * 2. form.UISchema - For testing single input React JSON Schema Forms
   * 2. form.customFormItems - JSON Form style
   * 3. (none) no input - don't import
   */
  initializeLayout() {
    // Rename JSON Form-style 'options' lists to
    // Angular Schema Form-style 'titleMap' lists.
    const fixJsonFormOptions = (layout) => {
      if (isObject(layout) || isArray(layout)) {
        forEach(layout, (value, key) => {
          if (hasOwn(value, 'options') && isObject(value.options)) {
            value.titleMap = value.options;
            delete value.options;
          }
        }, 'top-down');
      }
      return layout;
    };
    // Check for layout inputs and, if found, initialize form layout
    const form = this.form();
    const layoutValue = this.layout();
    if (isArray(layoutValue)) {
      this.jsf.layout = cloneDeep(layoutValue);
    }
    else if (isArray(form)) {
      this.jsf.AngularSchemaFormCompatibility = true;
      this.jsf.layout = cloneDeep(form);
    }
    else if (form && isArray(form.form)) {
      this.jsf.JsonFormCompatibility = true;
      this.jsf.layout = fixJsonFormOptions(cloneDeep(form.form));
    }
    else if (form && isArray(form.layout)) {
      this.jsf.layout = cloneDeep(form.layout);
    }
    else {
      this.jsf.layout = ['*'];
    }
    // Check for alternate layout inputs
    let alternateLayout = null;
    const formValue = this.form();
    const UISchema = this.UISchema();
    if (isObject(UISchema)) {
      this.jsf.ReactJsonSchemaFormCompatibility = true;
      alternateLayout = cloneDeep(UISchema);
    }
    else if (hasOwn(formValue, 'UISchema')) {
      this.jsf.ReactJsonSchemaFormCompatibility = true;
      alternateLayout = cloneDeep(formValue.UISchema);
    }
    else if (hasOwn(formValue, 'uiSchema')) {
      this.jsf.ReactJsonSchemaFormCompatibility = true;
      alternateLayout = cloneDeep(formValue.uiSchema);
    }
    else if (hasOwn(formValue, 'customFormItems')) {
      this.jsf.JsonFormCompatibility = true;
      alternateLayout = fixJsonFormOptions(cloneDeep(formValue.customFormItems));
    }
    // if alternate layout found, copy alternate layout options into schema
    if (alternateLayout) {
      JsonPointer.forEachDeep(alternateLayout, (value, pointer) => {
        const schemaPointer = pointer
          .replace(/\//g, '/properties/')
          .replace(/\/properties\/items\/properties\//g, '/items/properties/')
          .replace(/\/properties\/titleMap\/properties\//g, '/titleMap/properties/');
        if (hasValue(value) && hasValue(pointer)) {
          let key = JsonPointer.toKey(pointer);
          const groupPointer = (JsonPointer.parse(schemaPointer) || []).slice(0, -2);
          let itemPointer;
          // If 'ui:order' object found, copy into object schema root
          if (key.toLowerCase() === 'ui:order') {
            itemPointer = [...groupPointer, 'ui:order'];
            // Copy other alternate layout options to schema 'x-schema-form',
            // (like Angular Schema Form options) and remove any 'ui:' prefixes
          }
          else {
            if (key.slice(0, 3).toLowerCase() === 'ui:') {
              key = key.slice(3);
            }
            itemPointer = [...groupPointer, 'x-schema-form', key];
          }
          if (JsonPointer.has(this.jsf.schema, groupPointer) &&
            !JsonPointer.has(this.jsf.schema, itemPointer)) {
            JsonPointer.set(this.jsf.schema, itemPointer, value);
          }
        }
      });
    }
  }
  /**
   * 'activateForm' function
   *
   * ...continued from 'initializeSchema' function, above
   * If 'schema' has not been initialized (i.e. no schema input found)
   * 6. If layout input - build schema from layout input
   * 7. If data input - build schema from data input
   *
   * Create final layout,
   * build the FormGroup template and the Angular FormGroup,
   * subscribe to changes,
   * and activate the form.
   */
  activateForm() {
    this.unsubscribeOnActivateForm$.next();
    // If 'schema' not initialized
    if (isEmpty(this.jsf.schema)) {
      // TODO: If full layout input (with no '*'), build schema from layout
      // if (!this.jsf.layout.includes('*')) {
      //   this.jsf.buildSchemaFromLayout();
      // } else
      // If data input, build schema from data
      if (!isEmpty(this.jsf.formValues)) {
        this.jsf.buildSchemaFromData();
      }
    }
    if (!isEmpty(this.jsf.schema)) {
      // If not already initialized, initialize ajv and compile schema
      //this.jsf.compileAjvSchema();
      //moved to initializeAjv()
      // Fill 'dynamicDefaults' (ajv-keywords) into the initial form
      // values before the layout and FormGroup are built from them
      this.jsf.applyDynamicDefaults();
      // Update all layout elements, add values, widgets, and validators,
      // replace any '*' with a layout built from all schema elements,
      // and update the FormGroup template with any new validators
      this.jsf.buildLayout(this.widgetLibrary);
      // Build the Angular FormGroup template from the schema
      this.jsf.buildFormGroupTemplate(this.jsf.formValues);
      // Build the real Angular FormGroup from the FormGroup template
      this.jsf.buildFormGroup(this.ajvInstanceName);
    }
    if (this.jsf.formGroup) {
      // Reset initial form values
      if (!isEmpty(this.jsf.formValues) &&
        this.jsf.formOptions.setSchemaDefaults !== true &&
        this.jsf.formOptions.setLayoutDefaults !== true) {
        this.setFormValues(this.jsf.formValues);
      }
      // Subscribe to form changes to output live data, validation, and errors
      this.dataChangesSubs = this.jsf.dataChanges.pipe(takeUntil(this.unsubscribeOnActivateForm$)).subscribe(data => {
        this.emit('onChanges', this.objectWrap ? data['1'] : data);
        if (this.formValuesInput && this.formValuesInput.indexOf('.') === -1) {
          this.emit(`${this.formValuesInput}Change`, this.objectWrap ? data['1'] : data);
        }
      });
      // Trigger change detection on statusChanges to show updated errors
      this.statusChangesSubs = this.jsf.formGroup.statusChanges.pipe(takeUntil(this.unsubscribeOnActivateForm$)).subscribe(() => this.emit('markForCheck'));
      this.isValidChangesSubs = this.jsf.isValidChanges.pipe(takeUntil(this.unsubscribeOnActivateForm$)).subscribe(isValid => this.emit('isValid', isValid));
      this.validationErrorChangesSubs = this.jsf.validationErrorChanges.pipe(takeUntil(this.unsubscribeOnActivateForm$)).subscribe(err => this.emit('validationErrors', err));
      // Output final schema, final layout, and initial data
      this.emit('formSchema', this.jsf.schema);
      this.emit('formLayout', this.jsf.layout);
      this.emit('onChanges', this.objectWrap ? this.jsf.data['1'] : this.jsf.data);
      // If validateOnRender, output initial validation and any errors
      const validateOnRender = JsonPointer.get(this.jsf, '/formOptions/validateOnRender');
      if (validateOnRender) { // validateOnRender === 'auto' || true
        const touchAll = (control) => {
          if (validateOnRender === true || hasValue(control.value)) {
            control.markAsTouched();
          }
          Object.keys(control.controls || {})
            .forEach(key => touchAll(control.controls[key]));
        };
        touchAll(this.jsf.formGroup);
        this.emit('isValid', this.jsf.isValid);
        this.emit('validationErrors', this.jsf.ajvErrors);
      }
    }
    this.emit('activated');
  }
}
