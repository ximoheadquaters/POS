import { Image, View } from 'react-native';
import logo from '../../assets/ximo-logo.png';

interface BrandLogoProps {
  size?: number;
}

export function BrandLogo({ size = 64 }: BrandLogoProps) {
  return (
    <View style={{ height: size, overflow: 'hidden', width: size }}>
      <Image
        accessibilityLabel="Ximo Logo"
        accessible
        resizeMode="cover"
        source={logo}
        // The exported PNG has a dark artifact on its outer left edge. Crop its edge,
        // rather than exposing it on the splash screen or other brand surfaces.
        style={{ height: size + 2, left: -1, top: -1, width: size + 2 }}
      />
    </View>
  );
}
