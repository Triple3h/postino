import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useSettings } from '@/composables/useSettings'

export function useKeyboardShortcuts() {
  const store = useAppStore()
  const { toggleTheme } = useSettings()

  function handleKeydown(e: KeyboardEvent) {
    // Ctrl+Enter: Send request
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      // The send button handles this via @keydown.enter
    }

    // Ctrl+S: Save current API
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      const api = store.getCurrentApi()
      if (api) {
        store.updateApi(api.id, { updatedAt: Date.now() })
      }
    }

    // Ctrl+K: Global search (handled by GlobalSearch component)
    // Ctrl+Shift+A: Open popup (handled by extension)
    // Ctrl+Shift+S: Open side panel (handled by extension)
    // Ctrl+Shift+F: Open full page (handled by extension)

    // Ctrl+Shift+T: Toggle theme
    if (e.key === 'T' && e.ctrlKey && e.shiftKey) {
      e.preventDefault()
      toggleTheme()
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
}