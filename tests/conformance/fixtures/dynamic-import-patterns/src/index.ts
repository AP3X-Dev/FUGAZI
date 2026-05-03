import { render } from './static-utils';

export async function loadPage(name: 'about' | 'contact' | 'home'): Promise<string> {
  const mod = (await import(`./pages/${name}.js`)) as { render: () => string };
  return render(mod.render());
}
