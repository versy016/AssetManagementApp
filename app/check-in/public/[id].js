// app/check-in/public/[id].js
//
// Handles the path-style URL variant:  /check-in/public/<assetId>
//
// Expo Router merges dynamic-segment params into useLocalSearchParams(), so
// the existing PublicCheckInPage component picks up `id` automatically —
// no extra code needed here.
export { default } from '../public';
