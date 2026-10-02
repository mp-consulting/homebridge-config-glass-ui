/**
 * Port of formworks' WidgetLibraryService (@ng-formworks/core 21.7.0): the
 * map from layout node `type` to widget, with the same aliases and lookup
 * rules, holding React components instead of Angular ones.
 *
 * Copyright (c) 2014-2016 David Schnell-Davis 2018 Hamza Hamidi 2023 Zaheer M
 * (MIT License, see engine/json-schema-form.service.ts).
 */
import { hasOwn } from '../engine/utility.functions'
import { CheckboxesWidget, CheckboxWidget, RadiosWidget, SelectWidget } from './ChoiceWidgets'
import { InputWidget, NumberWidget, TextareaWidget } from './InputWidgets'
import { AddReferenceWidget, ButtonWidget, FileWidget, MessageWidget, NoneWidget, SubmitWidget, TemplateWidget } from './MiscWidgets'
import { RootWidget } from './RootWidget'
import { SectionWidget } from './SectionWidget'
import { SelectFrameworkWidget } from './SelectFrameworkWidget'
import { SelectWidgetWidget } from './SelectWidgetWidget'
import { OneOfWidget, TabsWidget } from './TabsWidget'

type WidgetEntry = any

export class WidgetLibraryService {
  defaultWidget = 'text'
  widgetLibrary: Record<string, WidgetEntry> = {
    // Angular JSON Schema Form administrative widgets
    'none': NoneWidget, // Placeholder, for development - displays nothing
    'root': RootWidget, // Form root, renders a complete layout
    'select-framework': SelectFrameworkWidget, // Applies the selected framework to a specified widget
    'select-widget': SelectWidgetWidget, // Displays a specified widget
    '$ref': AddReferenceWidget, // Button to add a new array item or $ref element
    // Free-form text HTML 'input' form control widgets <input type="...">
    'email': 'text',
    'integer': 'number', // Note: 'integer' is not a recognized HTML input type
    'number': NumberWidget,
    'password': 'text',
    'search': 'text',
    'tel': 'text',
    'text': InputWidget,
    'url': 'text',
    // Controlled text HTML 'input' form control widgets <input type="...">
    'color': 'text',
    'date': 'text',
    'datetime': 'text',
    'datetime-local': 'text',
    'month': 'text',
    'range': 'number',
    'time': 'text',
    'week': 'text',
    // Non-text HTML 'input' form control widgets <input type="...">
    'checkbox': CheckboxWidget,
    'file': FileWidget,
    'hidden': 'text',
    'image': 'text',
    'radio': 'radios',
    'reset': 'submit',
    'submit': SubmitWidget,
    // Other (non-'input') HTML form control widgets
    'button': ButtonWidget,
    'select': SelectWidget,
    'textarea': TextareaWidget,
    // HTML form control widget sets
    'checkboxes': CheckboxesWidget, // Grouped list of checkboxes
    'checkboxes-inline': 'checkboxes', // Checkboxes in one line
    'checkboxbuttons': 'checkboxes', // Checkboxes as html buttons
    'radios': RadiosWidget, // Grouped list of radio buttons
    'radios-inline': 'radios', // Radio controls in one line
    'radiobuttons': 'radios', // Radio controls as html buttons
    // HTML Layout widgets
    'section': SectionWidget, // Just a div <div>
    'div': 'section', // Still just a div <div>
    'fieldset': 'section', // A fieldset, with an optional legend <fieldset>
    'flex': 'section', // A flexbox container <div style="display: flex">
    // Non-HTML layout widgets
    'one-of': OneOfWidget, // A select box that changes another input
    'array': 'section', // A list you can add, remove and reorder <fieldset>
    'tabarray': 'tabs', // A tabbed version of array
    'tab': 'section', // A tab group, similar to a fieldset or section <fieldset>
    'tabs': TabsWidget, // A tabbed set of panels with different controls
    'message': MessageWidget, // Insert arbitrary html
    'help': 'message', // Insert arbitrary html
    'msg': 'message', // Insert arbitrary html
    'html': 'message', // Insert arbitrary html
    'template': TemplateWidget, // Insert a custom Angular component
    // Widgets included for compatibility with JSON Form API
    'advancedfieldset': 'section', // Adds 'Advanced settings' title <fieldset>
    'authfieldset': 'section', // Adds 'Authentication settings' title <fieldset>
    'optionfieldset': 'one-of', // Option control, displays selected sub-item <fieldset>
    'selectfieldset': 'one-of', // Select control, displays selected sub-item <fieldset>
    'conditional': 'section', // Identical to 'section' (depeciated) <div>
    'actions': 'section', // Horizontal button list, can only submit, uses buttons as items <div>
    'tagsinput': 'section', // For entering short text tags <div>
    // Widgets included for compatibility with React JSON Schema Form API
    'updown': 'number',
    'iso-date-time': 'datetime-local',
    'alt-datetime': 'datetime-local',
    'alt-date': 'date',
    // Widgets included for compatibility with Angular Schema Form API
    'wizard': 'section', // TODO: Sequential panels with "Next" and "Previous" buttons
    // Widgets included for compatibility with other libraries
    'textline': 'text',
    // TODO: formworks' SelectCheckboxComponent (a multi-select drawn as
    // checkboxes) is not ported; it falls back to the select widget.
    'selectcheckbox': 'select',
  }

  registeredWidgets: Record<string, WidgetEntry> = {}
  frameworkWidgets: Record<string, WidgetEntry> = {}
  activeWidgets: Record<string, WidgetEntry> = {}

  constructor() {
    this.setActiveWidgets()
  }

  setActiveWidgets() {
    this.activeWidgets = Object.assign({}, this.widgetLibrary, this.frameworkWidgets, this.registeredWidgets)
    for (const widgetName of Object.keys(this.activeWidgets)) {
      let widget = this.activeWidgets[widgetName]
      // Resolve aliases
      if (typeof widget === 'string') {
        const usedAliases: string[] = []
        while (typeof widget === 'string' && !usedAliases.includes(widget)) {
          usedAliases.push(widget)
          widget = this.activeWidgets[widget]
        }
        if (typeof widget !== 'string') {
          this.activeWidgets[widgetName] = widget
        }
      }
    }
    return true
  }

  setDefaultWidget(type: string) {
    if (!this.hasWidget(type)) {
      return false
    }
    this.defaultWidget = type
    return true
  }

  hasWidget(type: string, widgetSet: 'activeWidgets' | 'widgetLibrary' | 'registeredWidgets' | 'frameworkWidgets' = 'activeWidgets') {
    if (!type || typeof type !== 'string') {
      return false
    }
    return hasOwn(this[widgetSet], type)
  }

  hasDefaultWidget(type: string) {
    return this.hasWidget(type, 'widgetLibrary')
  }

  registerWidget(type: string, widget: WidgetEntry) {
    if (!type || !widget || typeof type !== 'string') {
      return false
    }
    this.registeredWidgets[type] = widget
    return this.setActiveWidgets()
  }

  unRegisterWidget(type: string) {
    if (!hasOwn(this.registeredWidgets, type)) {
      return false
    }
    delete this.registeredWidgets[type]
    return this.setActiveWidgets()
  }

  unRegisterAllWidgets(unRegisterFrameworkWidgets = true) {
    this.registeredWidgets = {}
    if (unRegisterFrameworkWidgets) {
      this.frameworkWidgets = {}
    }
    return this.setActiveWidgets()
  }

  registerFrameworkWidgets(widgets: Record<string, WidgetEntry> | null) {
    if (widgets === null || typeof widgets !== 'object') {
      widgets = {}
    }
    this.frameworkWidgets = widgets
    return this.setActiveWidgets()
  }

  unRegisterFrameworkWidgets() {
    if (Object.keys(this.frameworkWidgets).length) {
      this.frameworkWidgets = {}
      return this.setActiveWidgets()
    }
    return false
  }

  getWidget(type: string, widgetSet: 'activeWidgets' | 'widgetLibrary' | 'registeredWidgets' | 'frameworkWidgets' = 'activeWidgets') {
    if (this.hasWidget(type, widgetSet)) {
      return this[widgetSet][type]
    } else if (this.hasWidget(this.defaultWidget, widgetSet)) {
      return this[widgetSet][this.defaultWidget]
    } else {
      return null
    }
  }
}
