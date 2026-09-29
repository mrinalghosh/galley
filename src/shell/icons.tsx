// 16px stroke icons for the toolbar.
import type { ComponentChildren } from 'preact';

function Icon({ children }: { children: ComponentChildren }) {
  return (
    <svg class="g-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const PickIcon = () => (
  <Icon>
    <path d="M5 3l5.5 16 2.4-6.6L19.5 10z" />
  </Icon>
);

export const LassoIcon = () => (
  <Icon>
    <ellipse cx="12" cy="10" rx="8" ry="5.5" stroke-dasharray="3 2.5" />
    <path d="M7 14.5c-1 2 0 4.5 2.5 4.5" />
  </Icon>
);

export const CommentsIcon = () => (
  <Icon>
    <path d="M4 5h16v11H10l-5 4v-4H4z" />
  </Icon>
);

export const ErrorIcon = () => (
  <Icon>
    <path d="M12 3.5l9 16H3z" />
    <path d="M12 10v4.5M12 17.2v.3" />
  </Icon>
);

export const ReloadIcon = () => (
  <Icon>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4v4.5H15" />
  </Icon>
);

export const TerminalIcon = () => (
  <Icon>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M7 9.5l3 2.5-3 2.5M12.5 15h4" />
  </Icon>
);

export const ChevronRightIcon = () => (
  <Icon>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
