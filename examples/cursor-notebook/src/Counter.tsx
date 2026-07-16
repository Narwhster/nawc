import { useState } from "react";
import { countLabel } from "./counter-utils.js";
import "./styles.css";

export default function Counter() {
  const [count, setCount] = useState(0);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <section className="mx-auto max-w-md rounded-3xl border border-cyan-400/20 bg-slate-900 p-8 shadow-2xl shadow-cyan-950/40">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-cyan-300">
          Cursor notebook
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">A small React surface.</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Edit this TSX file with Cursor, then use the live preview to exercise local React state.
        </p>
        <div className="mt-8 flex items-center justify-between rounded-2xl bg-slate-800 p-4">
          <span className="text-sm text-slate-300">Current count</span>
          <span className="text-2xl font-semibold text-cyan-300">{countLabel(count)}</span>
        </div>
        <button
          className="mt-6 w-full rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 focus:outline-2 focus:outline-offset-2 focus:outline-cyan-300"
          type="button"
          onClick={() => setCount((value) => value + 1)}
        >
          Add an item
        </button>
      </section>
    </main>
  );
}
