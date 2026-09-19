import { Image, View } from 'react-native';
import logo from '../../assets/ximo-logo.png';

interface BrandLogoProps {
  size?: number;
}

export function BrandLogo({ size = 64 }: BrandLogoProps) {
  return (
    <View
      accessibilityLabel="Ximo Logo"
      accessible
      style={{ height: size, overflow: 'hidden', width: size }}
    >
      <Image
        resizeMode="cover"
        source={logo}
        style={{ height: size + 2, marginLeft: -1, marginTop: -1, width: size + 2 }}
      />
    </View>
  );
}
