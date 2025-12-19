<script lang="ts">
  import shieldLogoWithText from '$lib/assets/shield-logo-with-text.png';
  import shieldLogo from '$lib/assets/shield.png';

  type Size = 'tiny' | 'small' | 'medium' | 'large' | 'giant';
  type Props = {
    size?: Size | 'landing' | 'default';
    variant?: 'stacked' | 'inline' | 'logo' | 'icon';
    class?: string;
  };

  const { variant = 'logo', size = 'default', class: className }: Props = $props();

  const sizeClasses = {
    tiny: 'h-8',
    small: 'h-10',
    medium: 'h-12',
    large: 'h-16',
    giant: 'h-24',
    landing: 'h-64',
    default: '',
  };

  const variantClasses = {
    inline: 'max-md:h-[48px] h-[50px]',
    logo: 'bg-light aspect-square rounded-full shadow-lg',
    icon: 'aspect-square',
    stacked: '',
  };

  const classes = [sizeClasses[size], variantClasses[variant], className].filter(Boolean).join(' ');
</script>

<img src={variant === 'inline' ? shieldLogoWithText : shieldLogo} draggable="false" class={classes} />
