// test-users.js
const axios = require('axios');

const BASE_URL = 'http://ec2-13-239-139-73.ap-southeast-2.compute.amazonaws.com:3000/users';

const tests = [
  {
    name: 'GET all users',
    run: async () => {
      const res = await axios.get(`${BASE_URL}/list`);
      console.log('✅ GET users:', res.data);
    },
  },
  {
    name: 'POST new user - valid',
    run: async () => {
      const res = await axios.post(BASE_URL, {
        id: 'U10001',
        name: 'Test User',
        useremail: 'test@example.com',
      });
      console.log('✅ User created:', res.data);
    },
  },
  {
    name: 'POST new user - missing name',
    run: async () => {
      try {
        await axios.post(BASE_URL, {
          id: 'U10002',
          useremail: 'fail@example.com',
        });
      } catch (err) {
        console.log('✅ Expected failure (missing name):', err.response.data);
      }
    },
  },
  {
    name: 'GET specific user - valid ID',
    run: async () => {
      const res = await axios.get(`${BASE_URL}/U10001`);
      console.log('✅ Fetched user:', res.data);
    },
  },
  {
    name: 'GET specific user - invalid ID',
    run: async () => {
      try {
        await axios.get(`${BASE_URL}/nonexistent`);
      } catch (err) {
        console.log('✅ Expected failure (invalid ID):', err.response.data);
      }
    },
  },
  {
    name: 'PUT update user',
    run: async () => {
      const res = await axios.put(`${BASE_URL}/U10001`, {
        name: 'Updated User',
        useremail: 'updated@example.com',
      });
      console.log('✅ User updated:', res.data);
    },
  },
];

(async () => {
  for (const test of tests) {
    try {
      console.log(`\n🔹 Running test: ${test.name}`);
      await test.run();
    } catch (err) {
      console.error(`❌ Test failed: ${test.name}`, err.message);
    }
  }
})();
