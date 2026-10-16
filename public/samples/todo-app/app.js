import { addTodo, toggle, remaining } from './todo.js';

let todos = [];
const list = document.querySelector('#list');
const count = document.querySelector('#count');

function render() {
  list.innerHTML = '';
  todos.forEach((t, i) => {
    const li = document.createElement('li');
    li.textContent = t.text;
    if (t.done) li.style.textDecoration = 'line-through';
    li.onclick = () => { todos = toggle(todos, i); render(); };
    list.append(li);
  });
  count.textContent = `${remaining(todos)} left`;
}

document.querySelector('#add').onsubmit = (e) => {
  e.preventDefault();
  const input = document.querySelector('#text');
  todos = addTodo(todos, input.value);
  input.value = '';
  render();
};

render();
