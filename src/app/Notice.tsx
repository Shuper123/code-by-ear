// First-launch notice: driving safety and what leaves the phone.
export function Notice({ onAccept }: { onAccept: () => void }) {
  return (
    <div class="modal-back" role="dialog" aria-modal="true" aria-labelledby="notice-title">
      <div class="modal">
        <h2 id="notice-title">Before you start</h2>
        <p>
          <strong>Hands-free practice.</strong> Press Start before you pull out. After that everything is spoken, and
          the whole screen is one Pause button.
        </p>
        <p>Pause in heavy traffic, construction or bad weather. The road always comes first.</p>
        <p class="muted small">
          <strong>Privacy.</strong> Chrome's speech recognition sends your voice audio to Google to turn it into text.
          Your progress, notes, settings and API key stay on this phone. With an API key, only the drill and the text
          of your answer go to Anthropic for grading.
        </p>
        <button class="btn primary block" onClick={onAccept}>
          I understand
        </button>
      </div>
    </div>
  )
}
