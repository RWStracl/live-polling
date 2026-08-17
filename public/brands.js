// Shared brand config used by client.js and present.js to swap logo + accent
// color when the admin changes branding. Plain global (no bundler in this
// project), so this file must be loaded before those scripts.
window.BRANDS = {
  stracl: { name: 'Stracl', logo: '/logos/stracl-logo-white.svg', accent: '#FFDE69', accentHover: '#e6c65a' },
  jtask: { name: 'jTask', logo: '/logos/jTask-logo.svg', accent: '#1c75bc', accentHover: '#155c94' }
};
window.DEFAULT_ACCENT = { accent: '#6366f1', accentHover: '#4f46e5' };

window.applyBrand = function applyBrand(brand) {
  const logoEl = document.getElementById('brandLogo');
  const logoImg = document.getElementById('brandLogoImg');
  const config = window.BRANDS[brand];

  if (logoEl && logoImg) {
    if (config) {
      logoImg.src = config.logo;
      logoImg.alt = config.name + ' logo';
      logoEl.classList.remove('hidden');
    } else {
      logoEl.classList.add('hidden');
      logoImg.removeAttribute('src');
    }
  }

  const colors = config || window.DEFAULT_ACCENT;
  document.documentElement.style.setProperty('--accent', colors.accent);
  document.documentElement.style.setProperty('--accent-hover', colors.accentHover);
};
