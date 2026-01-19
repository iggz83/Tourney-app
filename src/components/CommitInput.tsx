import { useEffect, useRef, useState } from 'react'

/**
 * A controlled-ish input that buffers keystrokes locally and only commits to the parent on blur.
 * This prevents "disappearing letters" when parent state is being updated frequently (e.g. realtime sync).
 */
export function CommitInput(props: {
  value: string
  placeholder?: string
  className?: string
  onCommit: (next: string) => void
}) {
  const { value, placeholder, className, onCommit } = props
  const [draft, setDraft] = useState(value)
  const isFocused = useRef(false)

  // Keep draft in sync with external value when not actively editing.
  useEffect(() => {
    if (!isFocused.current) setDraft(value)
  }, [value])

  return (
    <input
      className={className}
      placeholder={placeholder}
      value={draft}
      onFocus={() => {
        isFocused.current = true
      }}
      onBlur={() => {
        isFocused.current = false
        const next = draft
        if (next !== value) onCommit(next)
      }}
      onChange={(e) => setDraft(e.target.value)}
    />
  )
}

