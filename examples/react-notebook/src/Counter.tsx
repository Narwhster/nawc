import { useState } from "react";
import "./counter.css";

export default function Counter() {
  const [count, setCount] = useState(0);

  return (
    <main>
      <p className="eyebrow">React interactive</p>
      <h1>Count with confidence.</h1>
      <p className="description">The component keeps its own React state inside the preview.</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Count is {count}
      </button>
    </main>
  );
}
