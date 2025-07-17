const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
    const payload = JSON.parse(event.body);

    const params = {
        TableName: 'Assets',
        Item: {
            AssetID: '12345', // You can generate this dynamically
            ...payload, // Spread the dynamic fields into the item
        },
    };

    try {
        await dynamoDB.put(params).promise();
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Item added successfully' }),
        };
    } catch (error) {
        console.error('Error adding item:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Could not add item' }),
        };
    }
};
