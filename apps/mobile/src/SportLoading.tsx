import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

export function SportLoading() {
  return (
    <View
      style={styles.screen}
      accessibilityLiveRegion="polite"
      accessibilityLabel="Getting your game plan ready."
    >
      <View style={styles.field} accessible={false} importantForAccessibility="no-hide-descendants">
        <View style={styles.line} />
        <View style={styles.circle} />
      </View>
      <Image
        source={require('../assets/brand-mark.png')}
        style={styles.logo}
        accessibilityLabel="TryoutFlow"
      />
      <Text style={styles.eyebrow}>READY. SET. TRYOUT.</Text>
      <Text style={styles.title}>Getting your game plan ready.</Text>
      <ActivityIndicator size="small" color="#80baff" />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0c1e30',
    padding: 36,
    gap: 22,
  },
  field: {
    position: 'absolute',
    top: 24,
    bottom: 24,
    left: 24,
    right: 24,
    borderWidth: 1,
    borderColor: '#ffffff16',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#ffffff16' },
  circle: { width: 180, height: 180, borderRadius: 90, borderWidth: 1, borderColor: '#ffffff16' },
  logo: { width: 100, height: 100, resizeMode: 'contain', tintColor: '#fff' },
  eyebrow: { color: '#ffbb57', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  title: {
    color: '#fff',
    fontSize: 29,
    lineHeight: 35,
    fontWeight: '800',
    textAlign: 'center',
    maxWidth: 320,
  },
});
