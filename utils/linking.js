import * as Linking from 'expo-linking';

const prefix = Linking.createURL('/');

export default {
  prefixes: [
    prefix,
    'assetmanager://',
    'https://ec2-3-25-81-127.ap-southeast-2.compute.amazonaws.com',
  ],
  config: {
    screens: {
      'check-in/[id]': {
        path: 'check-in/:id',
        parse: {
          id: (id) => `${id}`,
        },
      },
    },
  },
};
