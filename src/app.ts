export function boot(): void {
  const play = document.querySelector<HTMLButtonElement>('#play');
  const file = document.querySelector<HTMLInputElement>('#file');
  const status = document.querySelector<HTMLParagraphElement>('#status');
  const nowPlaying = document.querySelector<HTMLParagraphElement>('#now-playing');

  if (!play || !file || !status || !nowPlaying) {
    console.warn('Shell markup is missing expected controls');
    return;
  }

  nowPlaying.textContent = 'Demo · pulse.mp3';
  status.textContent = 'Empty shell. Playback ships in Phase 1.';

  play.addEventListener('click', () => {
    status.textContent = 'Playback is not wired yet (Phase 1).';
  });

  file.addEventListener('change', () => {
    const name = file.files?.[0]?.name;
    status.textContent = name
      ? `Selected ${name}. Import ships in Phase 5.`
      : 'No file selected.';
  });
}
