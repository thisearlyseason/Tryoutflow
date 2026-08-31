const workflow = [
  { number: '01', label: 'Registration', state: 'Registration open', detail: 'Guardian-led form' },
  { number: '02', label: 'Check-in', state: 'Checked in', detail: 'Bib #18 assigned' },
  { number: '03', label: 'Evaluate', state: 'Saved on device', detail: '2 of 3 complete' },
  { number: '04', label: 'Rankings', state: 'Rank 2 (tie)', detail: 'Completion shown' },
  { number: '05', label: 'Rosters', state: 'Draft roster', detail: 'Human review open' },
  { number: '06', label: 'Messages', state: 'Delivery queued', detail: 'Decision unchanged' },
] as const;

export function ProductProof() {
  return (
    <section
      aria-label="Tryout day workflow"
      className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-[var(--color-primary)]">
            Product proof, not promises
          </p>
          <h2
            className="mt-2 max-w-3xl text-3xl font-black tracking-tight sm:text-5xl"
            id="product-proof-title"
          >
            Tryout day, in one connected view
          </h2>
        </div>
        <p className="max-w-md text-sm text-[var(--color-text-muted)]">
          Synthetic labels show real workflow states without displaying athlete or guardian
          identity.
        </p>
      </div>

      <ol className="mt-8 grid overflow-hidden rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] sm:grid-cols-2 lg:grid-cols-6">
        {workflow.map((step) => (
          <li
            className="min-w-0 border-b border-[var(--color-border)] p-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"
            key={step.number}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-[family-name:var(--font-bib)] text-2xl text-[var(--color-primary)]">
                {step.number}
              </span>
              <span className="text-xs font-black uppercase tracking-wide text-[var(--color-text-muted)]">
                {step.label}
              </span>
            </div>
            <p className="mt-8 font-black">{step.state}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{step.detail}</p>
          </li>
        ))}
      </ol>

      <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[1.05fr_.95fr]">
        <article className="min-w-0 overflow-hidden rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-text)] p-5 text-white shadow-[var(--shadow-surface)] sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/20 pb-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#c7f000]">
                Evaluator view
              </p>
              <h3 className="mt-1 text-2xl font-black">Session 02 · Group Blue</h3>
            </div>
            <span className="rounded-full bg-[#c7f000] px-3 py-2 text-sm font-black text-[var(--color-performance-foreground)]">
              Synced
            </span>
          </div>
          <div className="grid gap-6 py-6 sm:grid-cols-[8rem_1fr] sm:items-center">
            <div className="flex aspect-square max-w-32 items-center justify-center rounded-full border-4 border-[#c7f000] font-[family-name:var(--font-bib)] text-5xl">
              18
            </div>
            <div>
              <p className="text-sm text-[#d8dee6]">Skating score</p>
              <div aria-label="Score 4 of 5" className="mt-3 grid grid-cols-5 gap-2" role="img">
                {[1, 2, 3, 4, 5].map((score) => (
                  <span
                    className={`flex aspect-square items-center justify-center rounded-[var(--radius-control)] border font-[family-name:var(--font-score)] font-black ${
                      score === 4
                        ? 'border-[#c7f000] bg-[#c7f000] text-[var(--color-performance-foreground)]'
                        : 'border-white/35'
                    }`}
                    key={score}
                  >
                    {score}
                  </span>
                ))}
              </div>
              <p className="mt-4 text-sm text-[#d8dee6]">
                Peer scores stay private during live evaluation.
              </p>
            </div>
          </div>
          <p className="border-t border-white/20 pt-4 text-sm text-[#d8dee6]">
            Device draft, sync, conflict, and completion states stay explicit.
          </p>
        </article>

        <article className="min-w-0 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-surface)] sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--color-primary)]">
                Director view
              </p>
              <h3 className="mt-1 text-2xl font-black">Rankings with context</h3>
            </div>
            <span className="rounded-full bg-[var(--color-selection)] px-3 py-2 text-sm font-black">
              Review open
            </span>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table
              aria-label="Ranking preview"
              className="w-full min-w-[17rem] border-collapse text-left text-sm"
            >
              <thead>
                <tr className="border-b-2 border-[var(--color-text)]">
                  <th className="px-2 py-3" scope="col">
                    Rank
                  </th>
                  <th className="px-2 py-3" scope="col">
                    Bib
                  </th>
                  <th className="px-2 py-3" scope="col">
                    Average
                  </th>
                  <th className="px-2 py-3" scope="col">
                    Complete
                  </th>
                </tr>
              </thead>
              <tbody className="font-[family-name:var(--font-score)]">
                <tr className="border-b border-[var(--color-border)]">
                  <td className="px-2 py-4 font-black">1</td>
                  <td className="px-2 py-4">#18</td>
                  <td className="px-2 py-4">4.42</td>
                  <td className="px-2 py-4">3/3</td>
                </tr>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)]">
                  <td className="px-2 py-4 font-black">2T</td>
                  <td className="px-2 py-4">#31</td>
                  <td className="px-2 py-4">4.10</td>
                  <td className="px-2 py-4">3/3</td>
                </tr>
                <tr>
                  <td className="px-2 py-4 font-black">2T</td>
                  <td className="px-2 py-4">#44</td>
                  <td className="px-2 py-4">4.10</td>
                  <td className="px-2 py-4">2/3</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-5 text-sm text-[var(--color-text-muted)]">
            Ties remain ties. Missing evaluations remain visible. Directors make and confirm roster
            decisions.
          </p>
        </article>
      </div>
    </section>
  );
}
