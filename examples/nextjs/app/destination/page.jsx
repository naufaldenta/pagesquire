import Ready from '../ready.jsx';
export default async function Destination() {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return (
    <main>
      <h1>Next.js destination ready</h1>
      <p data-destination="ready">Server-rendered destination committed.</p>
      <Ready />
    </main>
  );
}
