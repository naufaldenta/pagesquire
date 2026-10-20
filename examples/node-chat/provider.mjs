/** Deterministic local fixture, not an AI model. */
export class DemoProvider {
  async complete(messages) {
    let message = '';
    const results = [];
    for (const entry of messages) {
      if (entry.role !== 'user') continue;
      let data;
      try {
        data = JSON.parse(entry.content);
      } catch {}
      if (!data || typeof data !== 'object') {
        message = entry.content.toLowerCase();
        results.length = 0;
      } else if (data.browserResult) results.push(data.browserResult);
    }
    const queue = [];
    if (message.includes('navigate'))
      queue.push({
        capabilityId: 'browser.navigate',
        parameters: { url: '/next.html' },
      });
    if (message.includes('heading'))
      queue.push({
        capabilityId: 'accessibility.set_heading_color',
        parameters: { color: '#ff0000' },
      });
    if (message.includes('link'))
      queue.push({
        capabilityId: 'accessibility.set_link_highlight',
        parameters: { enabled: true },
      });
    if (message.includes('bold'))
      queue.push({
        capabilityId: 'accessibility.set_font_weight',
        parameters: { weight: 700 },
      });
    if (queue[results.length])
      return {
        text: 'Premature claim must be hidden',
        emotion: 'happy',
        finished: false,
        toolCalls: [queue[results.length]],
      };
    return {
      text: results.length
        ? 'The requested changes were verified on this page.'
        : 'This is a deterministic Node provider fixture.',
      emotion: results.length ? 'happy' : 'idle',
      finished: true,
      toolCalls: [],
    };
  }
}
