// Local-only eval fixture: tabs, switches, radios, validation and a
// destructive button.
const $ = (selector) => document.querySelector(selector);

for (const tab of document.querySelectorAll('[role="tab"]'))
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('[role="tab"]')) {
      other.setAttribute('aria-selected', String(other === tab));
      $(`#${other.getAttribute('aria-controls')}`).hidden = other !== tab;
    }
  });
for (const toggle of document.querySelectorAll('[role="switch"]'))
  toggle.addEventListener('click', () =>
    toggle.setAttribute(
      'aria-checked',
      String(toggle.getAttribute('aria-checked') !== 'true'),
    ),
  );
$('#profile-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test($('#email').value);
  $('#email-error').hidden = valid;
  $('#email').setAttribute('aria-invalid', String(!valid));
  $('#settings-saved').hidden = !valid;
  if (valid) $('#settings-saved').dataset.email = $('#email').value;
});
$('#delete-account').addEventListener('click', () => {
  $('#account-status').textContent = 'Account deleted';
});
