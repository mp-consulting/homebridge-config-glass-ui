/**
 * The Bootstrap 5 framework configuration of @ng-formworks/bootstrap5 21.7.0
 * (`cssFrameworkCfgBootstrap5`, as patched by
 * ui/patches/@ng-formworks+bootstrap5+21.7.0.patch: `btn-primary` add button,
 * `list-group-hb` / `list-group-item-hb`, `help-block grey-text small`), and
 * the default styling of @ng-formworks/cssframework's CssFrameworkComponent.
 *
 * Copyright (c) 2014-2016 David Schnell-Davis 2018 Hamza Hamidi 2023 Zaheer M
 * (MIT License, see engine/json-schema-form.service.ts).
 */

export const cssFrameworkDefaultStyling: Record<string, any> = {
  array: {},
  default: { fieldHtmlClass: 'cssfw-form-control' },
  __themes__: [{ name: 'notheme', text: 'None' }],
  __remove_item__: 'cssfw-remove-item',
  __array_item_nonref__: {
    htmlClass: 'cssfw-array-item-nonref',
  },
  __active__: { activeClass: 'cssfw-active' },
  __array__: { htmlClass: 'cssfw-array' },
  __control_label__: { labelHtmlClass: 'cssfw-control-label' },
  __form_group__: { htmlClass: 'cssfw-form-group' },
  __field_addon_left__: 'cssfw-addon-left',
  __field_addon_right__: 'cssfw-addon-right',
  __help_block__: 'cssfw-help-block',
  __required_asterisk__: 'cssfw-required-astersisk',
  __screen_reader__: 'cssfw-screen-reader',
}

export const cssFrameworkCfgBootstrap5 = {
  name: 'bootstrap-5',
  text: 'Bootstrap 5',
  scripts: [
    '//cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js',
  ],
  stylesheets: [
    '//cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css',
  ],
  widgetstyles: {
    '__themes__': [
      { name: 'bootstrap5_default', text: 'Bootstrap5 default' },
      { name: 'dark', text: 'Dark' },
      { name: 'light', text: 'Light' },
    ],
    '$ref': {
      fieldHtmlClass: 'btn btn-primary',
    },
    '__array_item_nonref__': {
      htmlClass: 'list-group-item list-group-item-hb',
    },
    '__form_group__': {
      htmlClass: 'form-group',
    },
    '__control_label__': {
      labelHtmlClass: 'control-label',
    },
    '__active__': {
      activeClass: 'active',
    },
    '__required_asterisk__': 'text-danger',
    '__screen_reader__': 'visually-hidden',
    '__remove_item__': 'btn-close  float-end',
    '__help_block__': 'help-block grey-text small',
    '__field_addon_left__': 'input-group-text',
    '__field_addon_right__': 'input-group-text',
    'alt-date': {},
    'alt-datetime': {},
    '__array__': {
      htmlClass: 'list-group list-group-hb',
    },
    'array': {},
    'authfieldset': {},
    'advancedfieldset': {},
    'button': {
      fieldHtmlClass: 'btn btn-sm btn-primary',
    },
    'checkbox': { fieldHtmlClass: 'form-check-input' },
    'checkboxes': {
      fieldHtmlClass: 'form-check-input',
    },
    'checkboxbuttons': {
      fieldHtmlClass: 'visually-hidden',
      htmlClass: 'btn-group',
      itemLabelHtmlClass: 'btn',
    },
    'checkboxes-inline': {
      htmlClass: 'form-check-input',
      itemLabelHtmlClass: 'form-check-inline',
    },
    'date': {},
    'datetime-local': {},
    'fieldset': {},
    'integer': {},
    'number': {},
    'optionfieldset': {},
    'password': {},
    'radiobuttons': {
      fieldHtmlClass: 'visually-hidden',
      htmlClass: 'btn-group',
      itemLabelHtmlClass: 'btn',
    },
    'radio': { fieldHtmlClass: 'form-check-input' },
    'radios': {
      fieldHtmlClass: 'form-check-input',
    },
    'radios-inline': {
      htmlClass: 'form-check form-check-inline',
      itemLabelHtmlClass: 'form-check-label',
    },
    'range': {},
    'section': {},
    'selectfieldset': {},
    'select': {
      fieldHtmlClass: 'form-select',
    },
    'submit': {
      fieldHtmlClass: 'btn btn-primary',
    },
    'text': {},
    'tabs': {
      labelHtmlClass: 'nav nav-tabs',
      htmlClass: 'tab-content',
      fieldHtmlClass: 'tab-pane',
      widget_radioClass: 'form-check-input',
    },
    'tabarray': {
      labelHtmlClass: 'nav nav-tabs',
      htmlClass: 'tab-content',
      fieldHtmlClass: 'tab-pane',
      widget_radioClass: 'form-check-input',
    },
    'one-of': {
      labelHtmlClass: 'nav nav-tabs',
      htmlClass: 'tab-content',
      fieldHtmlClass: 'tab-pane',
      widget_radioClass: 'form-check-input',
    },
    'textarea': {},
    'default': {
      fieldHtmlClass: 'form-control',
    },
  } as Record<string, any>,
}
