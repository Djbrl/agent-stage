// Pure logic, kept apart from the page so it can be tested.
export function addTodo(list, text) {
  return [...list, { text, done: false }];
}

export function toggle(list, i) {
  return list.map((t, j) => (j === i ? { ...t, done: !t.done } : t));
}

export function remaining(list) {
  return list.length;
}
