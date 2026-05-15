<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, shallowRef } from 'vue'
import { EditorView, placeholder as cmPlaceholder, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, highlightActiveLine, rectangularSelection, crosshairCursor } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, foldKeymap } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { yaml } from '@codemirror/lang-yaml'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'

type Language = 'json' | 'xml' | 'javascript' | 'html' | 'yaml' | 'text' | 'markdown'

const props = withDefaults(defineProps<{
  modelValue?: string
  language?: Language
  readonly?: boolean
  placeholder?: string
  lineNumbers?: boolean
  theme?: 'light' | 'dark'
}>(), {
  modelValue: '',
  language: 'text',
  readonly: false,
  placeholder: '',
  lineNumbers: true,
  theme: 'light',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'change': [value: string]
}>()

const editorRef = ref<HTMLDivElement>()
const view = shallowRef<EditorView>()
const languageCompartment = new Compartment()
const themeCompartment = new Compartment()
const readonlyCompartment = new Compartment()
let ignoreNextUpdate = false

function getLanguageExtension(lang: Language) {
  switch (lang) {
    case 'json': return json()
    case 'xml': return xml()
    case 'javascript': return javascript()
    case 'html': return html()
    case 'yaml': return yaml()
    case 'markdown': return markdown()
    case 'text': return []
    default: return []
  }
}

function getThemeExtension(theme: 'light' | 'dark') {
  return theme === 'dark' ? oneDark : []
}

function createExtensions() {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    languageCompartment.of(getLanguageExtension(props.language)),
    themeCompartment.of(getThemeExtension(props.theme)),
    readonlyCompartment.of(EditorState.readOnly.of(props.readonly)),
    props.placeholder ? cmPlaceholder(props.placeholder) : [],
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const value = update.state.doc.toString()
        ignoreNextUpdate = true
        emit('update:modelValue', value)
        emit('change', value)
      }
    }),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-content': { fontFamily: 'var(--font-code, monospace)' },
    }),
  ]
}

onMounted(() => {
  if (!editorRef.value) return
  const state = EditorState.create({
    doc: props.modelValue ?? '',
    extensions: createExtensions(),
  })
  view.value = new EditorView({
    state,
    parent: editorRef.value,
  })
})

onBeforeUnmount(() => {
  view.value?.destroy()
})

watch(() => props.modelValue, (val) => {
  if (ignoreNextUpdate) {
    ignoreNextUpdate = false
    return
  }
  const v = view.value
  if (!v) return
  const current = v.state.doc.toString()
  if (val === current) return
  v.dispatch({
    changes: { from: 0, to: current.length, insert: val ?? '' },
  })
})

watch(() => props.language, (lang) => {
  view.value?.dispatch({
    effects: languageCompartment.reconfigure(getLanguageExtension(lang)),
  })
})

watch(() => props.theme, (theme) => {
  view.value?.dispatch({
    effects: themeCompartment.reconfigure(getThemeExtension(theme)),
  })
})

watch(() => props.readonly, (ro) => {
  view.value?.dispatch({
    effects: readonlyCompartment.reconfigure(EditorState.readOnly.of(ro)),
  })
})
</script>

<template>
  <div ref="editorRef" class="cm-editor-wrapper"></div>
</template>

<style scoped>
.cm-editor-wrapper {
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-code);
}

.cm-editor-wrapper :deep(.cm-editor) {
  height: 100%;
  font-size: var(--font-size-code, 13px);
}

.cm-editor-wrapper :deep(.cm-editor.cm-focused) {
  outline: none;
  border-color: var(--primary);
}

.cm-editor-wrapper :deep(.cm-editor .cm-scroller) {
  font-family: var(--font-code, monospace);
}
</style>
