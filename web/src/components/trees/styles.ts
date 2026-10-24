// Keyframes/classes shared by plants and scenes. Injected once at module load.
// Only transform/opacity are animated so everything stays GPU-friendly.

const CSS = `
@keyframes pl-sway{from{transform:rotate(calc(var(--a,2deg) * -1))}to{transform:rotate(var(--a,2deg))}}
@keyframes pl-breathe{0%,100%{opacity:.3;transform:scale(.9)}50%{opacity:.85;transform:scale(1.1)}}
@keyframes pl-twinkle{0%,100%{opacity:.2;transform:scale(.5)}50%{opacity:1;transform:scale(1.15)}}
@keyframes pl-fall{0%{opacity:0;transform:translate(0,0) rotate(0deg)}12%{opacity:1}50%{transform:translate(calc(var(--dx,20px) * -.45),calc(var(--dy,80px) * .5)) rotate(calc(var(--r,240deg) * .5))}90%{opacity:.85}100%{opacity:0;transform:translate(var(--dx,20px),var(--dy,80px)) rotate(var(--r,240deg))}}
@keyframes pl-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes pl-flutter{0%,100%{transform:translate(0,0)}25%{transform:translate(20px,-9px)}50%{transform:translate(6px,-24px)}75%{transform:translate(-18px,-10px)}}
@keyframes pl-flap{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.2)}}
@keyframes pl-bee{0%,100%{transform:translate(0,0)}20%{transform:translate(26px,-8px)}40%{transform:translate(10px,14px)}60%{transform:translate(-24px,6px)}80%{transform:translate(-8px,-14px)}}
@keyframes pl-ripple{0%{transform:scale(.3);opacity:.7}100%{transform:scale(1.15);opacity:0}}
@keyframes pl-wiggle{0%,100%{transform:rotate(0)}20%{transform:rotate(-5deg)}45%{transform:rotate(4deg)}70%{transform:rotate(-2deg)}}
@keyframes pl-spin{to{transform:rotate(360deg)}}
@keyframes pl-drift{from{transform:translateX(-32%)}to{transform:translateX(105%)}}
@keyframes pl-rise{0%{opacity:0;transform:translate(0,0) scale(.6)}15%{opacity:.95}70%{opacity:.7}100%{opacity:0;transform:translate(var(--dx,10px),calc(var(--h,260px) * -.7)) scale(1)}}
@keyframes pl-rain{from{opacity:0;transform:translate(0,-10px)}10%{opacity:.7}to{opacity:0;transform:translate(-14px,calc(var(--h,260px) * .9))}}
@keyframes pl-confetti{0%{opacity:0;transform:translate(0,-14px) rotate(0deg)}8%{opacity:1}50%{transform:translate(var(--dx,16px),calc(var(--h,260px) * .5)) rotate(280deg)}100%{opacity:.9;transform:translate(calc(var(--dx,16px) * -1),calc(var(--h,260px) * .95)) rotate(560deg)}}
@keyframes pl-drop{0%{opacity:0;transform:translateY(-34px) scale(.7)}15%{opacity:1}70%{opacity:1;transform:translateY(0) scale(1)}78%,100%{opacity:0;transform:translateY(4px) scale(.4)}}
@keyframes pl-splash{0%,68%{opacity:0;transform:scale(.2)}74%{opacity:.7}100%{opacity:0;transform:scale(1.2)}}
@keyframes pl-bird{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.35)}}
@keyframes pl-pulse{0%,100%{opacity:.55}50%{opacity:1}}

.pl-sway{animation:pl-sway var(--t,5s) ease-in-out var(--d,0s) infinite alternate}
.pl-breathe{animation:pl-breathe var(--t,4.5s) ease-in-out var(--d,0s) infinite}
.pl-twinkle{animation:pl-twinkle var(--t,2.6s) ease-in-out var(--d,0s) infinite}
.pl-fall{opacity:0;animation:pl-fall var(--t,7s) ease-in-out var(--d,0s) infinite}
.pl-float{animation:pl-float var(--t,3.6s) ease-in-out var(--d,0s) infinite}
.pl-flutter{animation:pl-flutter 9s ease-in-out var(--d,0s) infinite}
.pl-flap{animation:pl-flap .35s ease-in-out infinite}
.pl-bee{animation:pl-bee 7s ease-in-out var(--d,0s) infinite}
.pl-ripple{opacity:0;animation:pl-ripple 3.6s ease-out var(--d,0s) infinite}
.pl-spin{animation:pl-spin var(--t,60s) linear infinite}
.pl-drift{animation:pl-drift var(--t,90s) linear var(--d,0s) infinite}
.pl-rise{opacity:0;animation:pl-rise var(--t,6s) ease-out var(--d,0s) infinite}
.pl-rain{opacity:0;animation:pl-rain var(--t,1.4s) linear var(--d,0s) infinite}
.pl-confetti{opacity:0;animation:pl-confetti var(--t,6s) ease-in-out var(--d,0s) infinite}
.pl-drop{opacity:0;animation:pl-drop 2.6s ease-in infinite}
.pl-splash{opacity:0;animation:pl-splash 2.6s ease-out infinite}
.pl-bird{animation:pl-bird .5s ease-in-out infinite}
.pl-pulse{animation:pl-pulse 2.4s ease-in-out infinite}
.pl-hoverwig{transform-origin:50% 90%}
.pl-hoverwig:hover{animation:pl-wiggle .7s ease-in-out}

.pl-grow{transition:transform 1.1s cubic-bezier(.34,1.4,.5,1),opacity .5s ease}
.pl-draw{transition:stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1),opacity .4s ease}
.pl-fade{transition:opacity 1.2s ease}
.pl-paused,.pl-paused *{animation-play-state:paused!important}

@media (prefers-reduced-motion:reduce){
  [class^="pl-"],[class*=" pl-"]{animation:none!important}
  .pl-grow,.pl-draw{transition-duration:.2s!important}
  .pl-fade{transition-duration:.3s!important}
}
`;

if (typeof document !== 'undefined' && !document.getElementById('plynth-plant-css')) {
  const el = document.createElement('style');
  el.id = 'plynth-plant-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

export {};
