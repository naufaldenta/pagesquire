// Local-only eval fixture: a todo list added with Enter, checkboxes,
// destructive delete buttons and pressed-state filters.
const $ = (selector) => document.querySelector(selector);
const tasks = [
  { title: 'Write report', done: false },
  { title: 'Call mom', done: false },
  { title: 'Water plants', done: true },
];
let filter = 'all';

function render() {
  const visible = tasks.filter(
    (task) => filter === 'all' || (filter === 'done' ? task.done : !task.done),
  );
  $('#tasks').replaceChildren(
    ...visible.map((task) => {
      const item = document.createElement('li');
      item.dataset.title = task.title;
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = task.done;
      box.addEventListener('change', () => {
        task.done = box.checked;
        render();
      });
      label.append(box, ` ${task.title}`);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete ${task.title}`);
      remove.addEventListener('click', () => {
        tasks.splice(tasks.indexOf(task), 1);
        render();
      });
      item.append(label, ' ', remove);
      return item;
    }),
  );
  $('#left').textContent = String(tasks.filter((task) => !task.done).length);
}

function add() {
  const title = $('#new-task').value.trim();
  if (!title) return;
  tasks.push({ title, done: false });
  $('#new-task').value = '';
  render();
}
$('#add-task').addEventListener('click', add);
$('#new-task').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') add();
});
for (const button of document.querySelectorAll('[data-filter]'))
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    for (const other of document.querySelectorAll('[data-filter]'))
      other.setAttribute('aria-pressed', String(other === button));
    render();
  });
$('#clear-completed').addEventListener('click', () => {
  for (let index = tasks.length - 1; index >= 0; index--)
    if (tasks[index].done) tasks.splice(index, 1);
  render();
});
render();
