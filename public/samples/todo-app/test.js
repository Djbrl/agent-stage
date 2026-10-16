import assert from 'node:assert';
import { addTodo, toggle } from './todo.js';

const list = addTodo([], 'buy bread');
assert.equal(list.length, 1);
assert.equal(toggle(list, 0)[0].done, true);
console.log('tests passed');
