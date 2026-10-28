// Local-only eval fixture: a small shop with filters, a cookie banner that
// covers the product list, an out-of-stock item and a long gift-card list.
const $ = (selector) => document.querySelector(selector);
const products = [
  { name: 'Desk Lamp', category: 'home', price: 30 },
  { name: 'Novel', category: 'books', price: 12 },
  { name: 'Cookbook', category: 'books', price: 25 },
  { name: 'Chess set', category: 'games', price: 40 },
  { name: 'Puzzle', category: 'games', price: 15 },
  { name: 'Vinyl record', category: 'music', price: 22, soldOut: true },
  { name: 'Headphones', category: 'music', price: 60 },
];
const cart = [];

function addToCart(name) {
  cart.push(name);
  $('#cart-count').textContent = String(cart.length);
  const item = document.createElement('li');
  item.textContent = name;
  $('#cart-items').append(item);
}

function render() {
  const query = $('#search').value.trim().toLowerCase();
  const categories = [
    ...document.querySelectorAll('input[name="category"]:checked'),
  ].map((input) => input.value);
  const sort = $('#sort').value;
  const visible = products
    .filter((product) => product.name.toLowerCase().includes(query))
    .filter(
      (product) => !categories.length || categories.includes(product.category),
    )
    .sort((a, b) =>
      sort === 'price-asc'
        ? a.price - b.price
        : sort === 'price-desc'
          ? b.price - a.price
          : 0,
    );
  $('#products').replaceChildren(
    ...visible.map((product) => {
      const item = document.createElement('li');
      item.dataset.product = product.name;
      item.textContent = `${product.name} - $${product.price} `;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = product.soldOut ? 'Sold out' : 'Add to cart';
      button.setAttribute('aria-label', `Add ${product.name} to cart`);
      button.disabled = Boolean(product.soldOut);
      button.addEventListener('click', () => addToCart(product.name));
      item.append(button);
      return item;
    }),
  );
}

$('#search').addEventListener('input', render);
$('#sort').addEventListener('change', render);
for (const input of document.querySelectorAll('input[name="category"]'))
  input.addEventListener('change', render);
for (const button of document.querySelectorAll('#cookie-banner button'))
  button.addEventListener('click', () => {
    $('#cookie-banner').hidden = true;
    $('#cookie-choice').textContent = button.dataset.choice;
  });
$('#checkout').addEventListener('click', () => {
  $('#order-status').textContent = cart.length
    ? `Order placed: ${cart.join(', ')}`
    : 'Your cart is empty';
});
const cards = [];
for (let index = 1; index <= 150; index++) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `Add gift card ${index}`;
  button.addEventListener('click', () => addToCart(`Gift card ${index}`));
  item.append(button);
  cards.push(item);
}
$('#gift-cards').append(...cards);
render();
