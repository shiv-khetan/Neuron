/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', 'class'],
  content: [
    "./index.html",
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
    "./examples/**/*.vw",
  ],
  // .vw views are authored at runtime, so Tailwind can't scan them at build.
  // Safelist the layout/spacing/sizing utilities views commonly use.
  safelist: [
    'grid', 'flex', 'flex-col', 'flex-row', 'flex-wrap', 'inline-flex', 'hidden', 'block',
    { pattern: /^(grid-cols|col-span|row-span|gap|gap-x|gap-y)-(1|2|3|4|5|6|7|8|9|10|11|12)$/, variants: ['sm', 'md', 'lg', 'xl'] },
    { pattern: /^(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|space-y|space-x)-(0|1|2|3|4|5|6|8|10|12)$/ },
    { pattern: /^(w|h|min-w|min-h|max-w)-(full|screen|fit|0|1|2|4|8|12|16|24|32|48|64|96)$/ },
    { pattern: /^(items|justify|content|self|place-items|place-content)-(start|end|center|between|around|evenly|stretch|baseline)$/ },
    { pattern: /^(text)-(left|center|right|xs|sm|base|lg|xl|2xl|3xl)$/ },
    { pattern: /^(font)-(normal|medium|semibold|bold|mono|sans)$/ },
    { pattern: /^(rounded|border)(-(none|sm|md|lg|xl|2xl|full|0|2|4))?$/ },
    'overflow-auto', 'overflow-hidden', 'truncate', 'sm:grid-cols-2', 'md:grid-cols-2', 'md:grid-cols-3', 'lg:grid-cols-3', 'xl:grid-cols-4',
  ],
  theme: {
  	extend: {
  		colors: {
  			border: 'var(--border)',
  			input: 'var(--input)',
  			ring: 'var(--ring)',
  			background: 'var(--background)',
  			foreground: 'var(--foreground)',
  			primary: {
  				DEFAULT: 'var(--primary)',
  				foreground: 'var(--primary-foreground)'
  			},
  			secondary: {
  				DEFAULT: 'var(--secondary)',
  				foreground: 'var(--secondary-foreground)'
  			},
  			muted: {
  				DEFAULT: 'var(--muted)',
  				foreground: 'var(--muted-foreground)'
  			},
  			accent: {
  				DEFAULT: 'var(--accent-bg)',
  				foreground: 'var(--accent-foreground)'
  			},
  			destructive: {
  				DEFAULT: 'var(--destructive)',
  				foreground: 'var(--destructive-foreground)'
  			},
  			popover: {
  				DEFAULT: 'var(--popover)',
  				foreground: 'var(--popover-foreground)'
  			},
  			card: {
  				DEFAULT: 'var(--card)',
  				foreground: 'var(--card-foreground)'
  			},
  			cyan: {
  				'400': '#22d3ee',
  				'500': '#06b6d4'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		fontFamily: {
  			sans: [
  				'Geist',
  				'ui-sans-serif',
  				'system-ui',
  				'sans-serif'
  			],
  			mono: [
  				'JetBrains Mono',
  				'ui-monospace',
  				'SFMono-Regular',
  				'Menlo',
  				'Monaco',
  				'Consolas',
  				'monospace'
  			]
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require('tailwindcss-animate')],
}
