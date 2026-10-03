export function createStore(initialState) {
  let state = structuredClone(initialState);
  const listeners = new Set();

  return {
    getState() {
      return state;
    },

    update(updater) {
      const next = typeof updater === "function" ? updater(state) : { ...state, ...updater };
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of listeners) listener(state);
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}
