import { Image } from 'react-native';
import logo from '../../assets/ximo-logo.png';

interface BrandLogoProps {
  size?: number;
}

export function BrandLogo({ size = 64 }: BrandLogoProps) {
  return (
    <Image
      accessibilityLabel="Ximo logo"
      accessible
      resizeMode="contain"
      source={logo}
      style={{ height: size, width: size }}
    />
  );
}
