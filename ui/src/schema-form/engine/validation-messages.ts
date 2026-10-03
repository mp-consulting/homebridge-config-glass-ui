/**
 * Vendored from @ng-formworks/core 21.7.0 (fesm2022/ng-formworks-core.mjs, lines 47-489),
 * as patched by ui/patches/@ng-formworks+core+21.7.0.patch. The logic is kept
 * line-for-line; only Angular decorators / ɵ metadata were removed and
 * @angular/forms was replaced by ./forms-shim. Do not edit by hand beyond that.
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


export const deValidationMessages = {
    required: 'Darf nicht leer sein',
    minLength: 'Mindestens {{minimumLength}} Zeichen benötigt (aktuell: {{currentLength}})',
    maxLength: 'Maximal {{maximumLength}} Zeichen erlaubt (aktuell: {{currentLength}})',
    pattern: 'Entspricht nicht diesem regulären Ausdruck: {{requiredPattern}}',
    format: function (error) {
        switch (error.requiredFormat) {
            case 'date':
                return 'Muss ein Datum sein, z. B. "2000-12-31"';
            case 'time':
                return 'Muss eine Zeitangabe sein, z. B. "16:20" oder "03:14:15.9265"';
            case 'date-time':
                return 'Muss Datum mit Zeit beinhalten, z. B. "2000-03-14T01:59" oder "2000-03-14T01:59:26.535Z"';
            case 'email':
                return 'Keine gültige E-Mail-Adresse (z. B. "name@example.com")';
            case 'hostname':
                return 'Kein gültiger Hostname (z. B. "example.com")';
            case 'ipv4':
                return 'Keine gültige IPv4-Adresse (z. B. "127.0.0.1")';
            case 'ipv6':
                return 'Keine gültige IPv6-Adresse (z. B. "1234:5678:9ABC:DEF0:1234:5678:9ABC:DEF0")';
            // TODO: add examples for 'uri', 'uri-reference', and 'uri-template'
            // case 'uri': case 'uri-reference': case 'uri-template':
            case 'url':
                return 'Keine gültige URL (z. B. "http://www.example.com/page.html")';
            case 'uuid':
                return 'Keine gültige UUID (z. B. "12345678-9ABC-DEF0-1234-56789ABCDEF0")';
            case 'color':
                return 'Kein gültiger Farbwert (z. B. "#FFFFFF")';
            case 'json-pointer':
                return 'Kein gültiger JSON-Pointer (z. B. "/pointer/to/something")';
            case 'relative-json-pointer':
                return 'Kein gültiger relativer JSON-Pointer (z. B. "2/pointer/to/something")';
            case 'regex':
                return 'Kein gültiger regulärer Ausdruck (z. B. "(1-)?\\d{3}-\\d{3}-\\d{4}")';
            case 'duration':
                return "Muss eine gültige ISO 8601-Dauer sein (z. B. 'PT1H30M')";
            default:
                return 'Muss diesem Format entsprechen: ' + error.requiredFormat;
        }
    },
    minimum: 'Muss mindestens {{minimumValue}} sein',
    exclusiveMinimum: 'Muss größer als {{exclusiveMinimumValue}} sein',
    maximum: 'Darf maximal {{maximumValue}} sein',
    exclusiveMaximum: 'Muss kleiner als {{exclusiveMaximumValue}} sein',
    multipleOf: function (error) {
        if ((1 / error.multipleOfValue) % 10 === 0) {
            const decimals = Math.log10(1 / error.multipleOfValue);
            return `Maximal ${decimals} Dezimalstellen erlaubt`;
        }
        else {
            return `Muss ein Vielfaches von ${error.multipleOfValue} sein`;
        }
    },
    minProperties: 'Mindestens {{minimumProperties}} Attribute erforderlich (aktuell: {{currentProperties}})',
    maxProperties: 'Maximal {{maximumProperties}} Attribute erlaubt (aktuell: {{currentProperties}})',
    minItems: 'Mindestens {{minimumItems}} Werte erforderlich (aktuell: {{currentItems}})',
    maxItems: 'Maximal {{maximumItems}} Werte erlaubt (aktuell: {{currentItems}})',
    uniqueItems: 'Alle Werte müssen eindeutig sein',
    // Note: No default error messages for 'type', 'const', 'enum', or 'dependencies'
};

export const enValidationMessages = {
    required: 'This field is required.',
    minLength: 'Must be {{minimumLength}} characters or longer (current length: {{currentLength}})',
    maxLength: 'Must be {{maximumLength}} characters or shorter (current length: {{currentLength}})',
    pattern: 'Must match pattern: {{requiredPattern}}',
    format: function (error) {
        switch (error.requiredFormat) {
            case 'date':
                return 'Must be a date, like "2000-12-31"';
            case 'time':
                return 'Must be a time, like "16:20" or "03:14:15.9265"';
            case 'date-time':
                return 'Must be a date-time, like "2000-03-14T01:59" or "2000-03-14T01:59:26.535Z"';
            case 'email':
                return 'Must be an email address, like "name@example.com"';
            case 'hostname':
                return 'Must be a hostname, like "example.com"';
            case 'ipv4':
                return 'Must be an IPv4 address, like "127.0.0.1"';
            case 'ipv6':
                return 'Must be an IPv6 address, like "1234:5678:9ABC:DEF0:1234:5678:9ABC:DEF0"';
            // TODO: add examples for 'uri', 'uri-reference', and 'uri-template'
            // case 'uri': case 'uri-reference': case 'uri-template':
            case 'url':
                return 'Must be a url, like "http://www.example.com/page.html"';
            case 'uuid':
                return 'Must be a uuid, like "12345678-9ABC-DEF0-1234-56789ABCDEF0"';
            case 'color':
                return 'Must be a color, like "#FFFFFF"';
            case 'json-pointer':
                return 'Must be a JSON Pointer, like "/pointer/to/something"';
            case 'relative-json-pointer':
                return 'Must be a relative JSON Pointer, like "2/pointer/to/something"';
            case 'regex':
                return 'Must be a regular expression, like "(1-)?\\d{3}-\\d{3}-\\d{4}"';
            case 'duration':
                return "Must be a valid ISO 8601 duration (e.g., 'PT1H30M')";
            default:
                return 'Must be a correctly formatted ' + error.requiredFormat;
        }
    },
    minimum: 'Must be {{minimumValue}} or more',
    exclusiveMinimum: 'Must be more than {{exclusiveMinimumValue}}',
    maximum: 'Must be {{maximumValue}} or less',
    exclusiveMaximum: 'Must be less than {{exclusiveMaximumValue}}',
    multipleOf: function (error) {
        if ((1 / error.multipleOfValue) % 10 === 0) {
            const decimals = Math.log10(1 / error.multipleOfValue);
            return `Must have ${decimals} or fewer decimal places.`;
        }
        else {
            return `Must be a multiple of ${error.multipleOfValue}.`;
        }
    },
    minProperties: 'Must have {{minimumProperties}} or more items (current items: {{currentProperties}})',
    maxProperties: 'Must have {{maximumProperties}} or fewer items (current items: {{currentProperties}})',
    minItems: 'Must have {{minimumItems}} or more items (current items: {{currentItems}})',
    maxItems: 'Must have {{maximumItems}} or fewer items (current items: {{currentItems}})',
    uniqueItems: 'All items must be unique',
    // Note: No default error messages for 'type', 'const', 'enum', or 'dependencies'
};

export const esValidationMessages = {
    required: 'Este campo está requerido.',
    minLength: 'Debe tener {{minimumLength}} caracteres o más longitud (longitud actual: {{currentLength}})',
    maxLength: 'Debe tener {{maximumLength}} caracteres o menos longitud (longitud actual: {{currentLength}})',
    pattern: 'Must match pattern: {{requiredPattern}}',
    format: function (error) {
        switch (error.requiredFormat) {
            case 'date':
                return 'Debe tener una fecha, ej "2000-12-31"';
            case 'time':
                return 'Debe tener una hora, ej "16:20" o "03:14:15.9265"';
            case 'date-time':
                return 'Debe tener fecha y hora, ej "2000-03-14T01:59" o "2000-03-14T01:59:26.535Z"';
            case 'email':
                return 'No hay dirección de correo electrónico válida, ej "name@example.com"';
            case 'hostname':
                return 'Debe ser un nombre de host válido, ej "example.com"';
            case 'ipv4':
                return 'Debe ser una dirección de IPv4, ej "127.0.0.1"';
            case 'ipv6':
                return 'Debe ser una dirección de IPv6, ej "1234:5678:9ABC:DEF0:1234:5678:9ABC:DEF0"';
            case 'url':
                return 'Debe ser una URL, ej "http://www.example.com/page.html"';
            case 'uuid':
                return 'Debe ser un UUID, ej "12345678-9ABC-DEF0-1234-56789ABCDEF0"';
            case 'color':
                return 'Debe ser un color, ej "#FFFFFF"';
            case 'json-pointer':
                return 'Debe ser un JSON Pointer, ej "/pointer/to/something"';
            case 'relative-json-pointer':
                return 'Debe ser un JSON Pointer relativo, ej "2/pointer/to/something"';
            case 'regex':
                return 'Debe ser una expresión regular, ej "(1-)?\\d{3}-\\d{3}-\\d{4}"';
            case 'duration':
                return "Debe ser una duración válida en formato ISO 8601 (p. ej., 'PT1H30M')";
            default:
                return 'Debe tener el formato correcto ' + error.requiredFormat;
        }
    },
    minimum: 'Debe ser {{minimumValue}} o más',
    exclusiveMinimum: 'Debe ser superior a {{exclusiveMinimumValue}}',
    maximum: 'Debe ser {{maximumValue}} o menos',
    exclusiveMaximum: 'Debe ser menor que {{exclusiveMaximumValue}}',
    multipleOf: function (error) {
        if ((1 / error.multipleOfValue) % 10 === 0) {
            const decimals = Math.log10(1 / error.multipleOfValue);
            return `Se permite un máximo de ${decimals} decimales`;
        }
        else {
            return `Debe ser múltiplo de ${error.multipleOfValue}.`;
        }
    },
    minProperties: 'Debe tener {{minimumProperties}} o más elementos (elementos actuales: {{currentProperties}})',
    maxProperties: 'Debe tener {{maximumProperties}} o menos elementos (elementos actuales: {{currentProperties}})',
    minItems: 'Debe tener {{minimumItems}} o más elementos (elementos actuales: {{currentItems}})',
    maxItems: 'Debe tener {{maximumItems}} o menos elementos (elementos actuales: {{currentItems}})',
    uniqueItems: 'Todos los elementos deben ser únicos',
};

export const frValidationMessages = {
    required: 'Est obligatoire.',
    minLength: 'Doit avoir minimum {{minimumLength}} caractères (actuellement: {{currentLength}})',
    maxLength: 'Doit avoir maximum {{maximumLength}} caractères (actuellement: {{currentLength}})',
    pattern: 'Doit respecter: {{requiredPattern}}',
    format: function (error) {
        switch (error.requiredFormat) {
            case 'date':
                return 'Doit être une date, tel que "2000-12-31"';
            case 'time':
                return 'Doit être une heure, tel que "16:20" ou "03:14:15.9265"';
            case 'date-time':
                return 'Doit être une date et une heure, tel que "2000-03-14T01:59" ou "2000-03-14T01:59:26.535Z"';
            case 'email':
                return 'Doit être une adresse e-mail, tel que "name@example.com"';
            case 'hostname':
                return 'Doit être un nom de domaine, tel que "example.com"';
            case 'ipv4':
                return 'Doit être une adresse IPv4, tel que "127.0.0.1"';
            case 'ipv6':
                return 'Doit être une adresse IPv6, tel que "1234:5678:9ABC:DEF0:1234:5678:9ABC:DEF0"';
            // TODO: add examples for 'uri', 'uri-reference', and 'uri-template'
            // case 'uri': case 'uri-reference': case 'uri-template':
            case 'url':
                return 'Doit être une URL, tel que "http://www.example.com/page.html"';
            case 'uuid':
                return 'Doit être un UUID, tel que "12345678-9ABC-DEF0-1234-56789ABCDEF0"';
            case 'color':
                return 'Doit être une couleur, tel que "#FFFFFF"';
            case 'json-pointer':
                return 'Doit être un JSON Pointer, tel que "/pointer/to/something"';
            case 'relative-json-pointer':
                return 'Doit être un relative JSON Pointer, tel que "2/pointer/to/something"';
            case 'regex':
                return 'Doit être une expression régulière, tel que "(1-)?\\d{3}-\\d{3}-\\d{4}"';
            case 'duration':
                return "Doit être une durée valide au format ISO 8601 (par ex., 'PT1H30M')";
            default:
                return 'Doit être avoir le format correct: ' + error.requiredFormat;
        }
    },
    minimum: 'Doit être supérieur à {{minimumValue}}',
    exclusiveMinimum: 'Doit avoir minimum {{exclusiveMinimumValue}} charactères',
    maximum: 'Doit être inférieur à {{maximumValue}}',
    exclusiveMaximum: 'Doit avoir maximum {{exclusiveMaximumValue}} charactères',
    multipleOf: function (error) {
        if ((1 / error.multipleOfValue) % 10 === 0) {
            const decimals = Math.log10(1 / error.multipleOfValue);
            return `Doit comporter ${decimals} ou moins de decimales.`;
        }
        else {
            return `Doit être un multiple de ${error.multipleOfValue}.`;
        }
    },
    minProperties: 'Doit comporter au minimum {{minimumProperties}} éléments',
    maxProperties: 'Doit comporter au maximum {{maximumProperties}} éléments',
    minItems: 'Doit comporter au minimum {{minimumItems}} éléments',
    maxItems: 'Doit comporter au maximum {{maximumItems}} éléments',
    uniqueItems: 'Tous les éléments doivent être uniques',
    // Note: No default error messages for 'type', 'const', 'enum', or 'dependencies'
};

export const itValidationMessages = {
    required: 'Il campo è obbligatorio',
    minLength: 'Deve inserire almeno {{minimumLength}} caratteri (lunghezza corrente: {{currentLength}})',
    maxLength: 'Il numero massimo di caratteri consentito è {{maximumLength}} (lunghezza corrente: {{currentLength}})',
    pattern: 'Devi rispettare il pattern : {{requiredPattern}}',
    format: function (error) {
        switch (error.requiredFormat) {
            case 'date':
                return 'Deve essere una data, come "31-12-2000"';
            case 'time':
                return 'Deve essere un orario, come "16:20" o "03:14:15.9265"';
            case 'date-time':
                return 'Deve essere data-orario, come "14-03-2000T01:59" or "14-03-2000T01:59:26.535Z"';
            case 'email':
                return 'Deve essere un indirzzo email, come "name@example.com"';
            case 'hostname':
                return 'Deve essere un hostname, come "example.com"';
            case 'ipv4':
                return 'Deve essere un indirizzo IPv4, come "127.0.0.1"';
            case 'ipv6':
                return 'Deve essere un indirizzo IPv6, come "1234:5678:9ABC:DEF0:1234:5678:9ABC:DEF0"';
            // TODO: add examples for 'uri', 'uri-reference', and 'uri-template'
            // case 'uri': case 'uri-reference': case 'uri-template':
            case 'url':
                return 'Deve essere un url, come "http://www.example.com/page.html"';
            case 'uuid':
                return 'Deve essere un uuid, come "12345678-9ABC-DEF0-1234-56789ABCDEF0"';
            case 'color':
                return 'Deve essere un colore, come "#FFFFFF"';
            case 'json-pointer':
                return 'Deve essere un JSON Pointer, come "/pointer/to/something"';
            case 'relative-json-pointer':
                return 'Deve essere un JSON Pointer relativo, come "2/pointer/to/something"';
            case 'regex':
                return 'Deve essere una regular expression, come "(1-)?\\d{3}-\\d{3}-\\d{4}"';
            case 'duration':
                return "Deve essere una durata valida nel formato ISO 8601 (es. 'PT1H30M')";
            default:
                return 'Deve essere formattato correttamente ' + error.requiredFormat;
        }
    },
    minimum: 'Deve essere {{minimumValue}} o più',
    exclusiveMinimum: 'Deve essere più di {{exclusiveMinimumValue}}',
    maximum: 'Deve essere {{maximumValue}} o meno',
    exclusiveMaximum: 'Deve essere minore di {{exclusiveMaximumValue}}',
    multipleOf: function (error) {
        if ((1 / error.multipleOfValue) % 10 === 0) {
            const decimals = Math.log10(1 / error.multipleOfValue);
            return `Deve avere ${decimals} o meno decimali.`;
        }
        else {
            return `Deve essere multiplo di ${error.multipleOfValue}.`;
        }
    },
    minProperties: 'Deve avere {{minimumProperties}} o più elementi (elementi correnti: {{currentProperties}})',
    maxProperties: 'Deve avere {{maximumProperties}} o meno elementi (elementi correnti: {{currentProperties}})',
    minItems: 'Deve avere {{minimumItems}} o più elementi (elementi correnti: {{currentItems}})',
    maxItems: 'Deve avere {{maximumItems}} o meno elementi (elementi correnti: {{currentItems}})',
    uniqueItems: 'Tutti gli elementi devono essere unici',
    // Note: No default error messages for 'type', 'const', 'enum', or 'dependencies'
};

export const ptValidationMessages = {
    required: 'Este campo é obrigatório.',
    minLength: 'É preciso no mínimo {{minimumLength}} caracteres ou mais (tamanho atual: {{currentLength}})',
    maxLength: 'É preciso no máximo  {{maximumLength}} caracteres ou menos (tamanho atual: {{currentLength}})',
    pattern: 'Tem que ajustar ao formato: {{requiredPattern}}',
    format: function (error) {
        switch (error.requiredFormat) {
            case 'date':
                return 'Tem que ser uma data, por exemplo "2000-12-31"';
            case 'time':
                return 'Tem que ser horário, por exemplo "16:20" ou "03:14:15.9265"';
            case 'date-time':
                return 'Tem que ser data e hora, por exemplo "2000-03-14T01:59" ou "2000-03-14T01:59:26.535Z"';
            case 'email':
                return 'Tem que ser um email, por exemplo "fulano@exemplo.com.br"';
            case 'hostname':
                return 'Tem que ser uma nome de domínio, por exemplo "exemplo.com.br"';
            case 'ipv4':
                return 'Tem que ser um endereço IPv4, por exemplo "127.0.0.1"';
            case 'ipv6':
                return 'Tem que ser um endereço IPv6, por exemplo "1234:5678:9ABC:DEF0:1234:5678:9ABC:DEF0"';
            // TODO: add examples for 'uri', 'uri-reference', and 'uri-template'
            // case 'uri': case 'uri-reference': case 'uri-template':
            case 'url':
                return 'Tem que ser uma URL, por exemplo "http://www.exemplo.com.br/pagina.html"';
            case 'uuid':
                return 'Tem que ser um uuid, por exemplo "12345678-9ABC-DEF0-1234-56789ABCDEF0"';
            case 'color':
                return 'Tem que ser uma cor, por exemplo "#FFFFFF"';
            case 'json-pointer':
                return 'Tem que ser um JSON Pointer, por exemplo "/referencia/para/algo"';
            case 'relative-json-pointer':
                return 'Tem que ser um JSON Pointer relativo, por exemplo "2/referencia/para/algo"';
            case 'regex':
                return 'Tem que ser uma expressão regular, por exemplo "(1-)?\\d{3}-\\d{3}-\\d{4}"';
            case 'duration':
                return "Deve ser uma duração válida no formato ISO 8601 (ex.: 'PT1H30M')";
            default:
                return 'Tem que ser no formato: ' + error.requiredFormat;
        }
    },
    minimum: 'Tem que ser {{minimumValue}} ou mais',
    exclusiveMinimum: 'Tem que ser mais que {{exclusiveMinimumValue}}',
    maximum: 'Tem que ser {{maximumValue}} ou menos',
    exclusiveMaximum: 'Tem que ser menor que {{exclusiveMaximumValue}}',
    multipleOf: function (error) {
        if ((1 / error.multipleOfValue) % 10 === 0) {
            const decimals = Math.log10(1 / error.multipleOfValue);
            return `Tem que ter ${decimals} ou menos casas decimais.`;
        }
        else {
            return `Tem que ser um múltiplo de ${error.multipleOfValue}.`;
        }
    },
    minProperties: 'Deve ter {{minimumProperties}} ou mais itens (itens até o momento: {{currentProperties}})',
    maxProperties: 'Deve ter {{maximumProperties}} ou menos intens (itens até o momento: {{currentProperties}})',
    minItems: 'Deve ter {{minimumItems}} ou mais itens (itens até o momento: {{currentItems}})',
    maxItems: 'Deve ter {{maximumItems}} ou menos itens (itens até o momento: {{currentItems}})',
    uniqueItems: 'Todos os itens devem ser únicos',
    // Note: No default error messages for 'type', 'const', 'enum', or 'dependencies'
};

export const zhValidationMessages = {
    required: '必填字段.',
    minLength: '字符长度必须大于或者等于 {{minimumLength}} (当前长度: {{currentLength}})',
    maxLength: '字符长度必须小于或者等于 {{maximumLength}} (当前长度: {{currentLength}})',
    pattern: '必须匹配正则表达式: {{requiredPattern}}',
    format: function (error) {
        switch (error.requiredFormat) {
            case 'date':
                return '必须为日期格式, 比如 "2000-12-31"';
            case 'time':
                return '必须为时间格式, 比如 "16:20" 或者 "03:14:15.9265"';
            case 'date-time':
                return '必须为日期时间格式, 比如 "2000-03-14T01:59" 或者 "2000-03-14T01:59:26.535Z"';
            case 'email':
                return '必须为邮箱地址, 比如 "name@example.com"';
            case 'hostname':
                return '必须为主机名, 比如 "example.com"';
            case 'ipv4':
                return '必须为 IPv4 地址, 比如 "127.0.0.1"';
            case 'ipv6':
                return '必须为 IPv6 地址, 比如 "1234:5678:9ABC:DEF0:1234:5678:9ABC:DEF0"';
            // TODO: add examples for 'uri', 'uri-reference', and 'uri-template'
            // case 'uri': case 'uri-reference': case 'uri-template':
            case 'url':
                return '必须为 url, 比如 "http://www.example.com/page.html"';
            case 'uuid':
                return '必须为 uuid, 比如 "12345678-9ABC-DEF0-1234-56789ABCDEF0"';
            case 'color':
                return '必须为颜色值, 比如 "#FFFFFF"';
            case 'json-pointer':
                return '必须为 JSON Pointer, 比如 "/pointer/to/something"';
            case 'relative-json-pointer':
                return '必须为相对的 JSON Pointer, 比如 "2/pointer/to/something"';
            case 'regex':
                return '必须为正则表达式, 比如 "(1-)?\\d{3}-\\d{3}-\\d{4}"';
            case 'duration':
                return "必须是有效的 ISO 8601 持续时间（例如：'PT1H30M'）";
            default:
                return '必须为格式正确的 ' + error.requiredFormat;
        }
    },
    minimum: '必须大于或者等于最小值: {{minimumValue}}',
    exclusiveMinimum: '必须大于最小值: {{exclusiveMinimumValue}}',
    maximum: '必须小于或者等于最大值: {{maximumValue}}',
    exclusiveMaximum: '必须小于最大值: {{exclusiveMaximumValue}}',
    multipleOf: function (error) {
        if ((1 / error.multipleOfValue) % 10 === 0) {
            const decimals = Math.log10(1 / error.multipleOfValue);
            return `必须有 ${decimals} 位或更少的小数位`;
        }
        else {
            return `必须为 ${error.multipleOfValue} 的倍数`;
        }
    },
    minProperties: '项目数必须大于或者等于 {{minimumProperties}} (当前项目数: {{currentProperties}})',
    maxProperties: '项目数必须小于或者等于 {{maximumProperties}} (当前项目数: {{currentProperties}})',
    minItems: '项目数必须大于或者等于 {{minimumItems}} (当前项目数: {{currentItems}})',
    maxItems: '项目数必须小于或者等于 {{maximumItems}} (当前项目数: {{currentItems}})',
    uniqueItems: '所有项目必须是唯一的',
    // Note: No default error messages for 'type', 'const', 'enum', or 'dependencies'
};

/**
 * '_executeValidators' utility function
 *
 * Validates a control against an array of validators, and returns
 * an array of the same length containing a combination of error messages
 * (from invalid validators) and null values (from valid validators)
 *
 * //  { AbstractControl } control - control to validate
 * //  { IValidatorFn[] } validators - array of validators
 * //  { boolean } invert - invert?
 * // { PlainObject[] } - array of nulls and error message
 */
