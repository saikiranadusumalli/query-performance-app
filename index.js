const express = require('express');
const bodyParser = require('body-parser');
const sql = require('mssql');
const path = require('path');
const redis = require('redis');
const { createClient } = require('redis');
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));


const dbConfig = {
    user: 'manohardatabaseserver',
    password: 'Jhoncena886@',
    server: 'manohardatabaseserver.database.windows.net',
    database: 'manohardatabaseq3',
    options: {
        encrypt: true, // Use encryption
        enableArithAbort: true
    }
};


const redisClient = createClient({
    socket: {
        host: 'manoharredis.redis.cache.windows.net',
        port: 6380,
        tls: true
    },
    password: 'RLnDd5NAorTnPSezhgqUSUWDcfwSC4GXtAzCaPihR2I='
});

redisClient.on('error', (err) => console.error('Redis error', err));

// Ensure the Redis client connects
redisClient.connect().catch(console.error);


// Routes
app.get('/', (req, res) => {
    res.render('index');
});

app.post('/run_queries', async (req, res) => {
    const queryType = req.body.query_type;
    const numQueries = parseInt(req.body.num_queries);
    const restriction = req.body.restriction;

    let result;
    try {
        await sql.connect(dbConfig);
        if (queryType === 'random') {
            result = await runRandomQueries(numQueries);
        } else if (queryType === 'restricted') {
            result = await runRestrictedQueries(numQueries, restriction);
        }
        res.json(result);
    } catch (err) {
        console.error('SQL error', err);
        res.status(500).send('Error running queries');
    } finally {
        sql.close();
    }
});

const runRandomQueries = async (numQueries) => {
    let queryTimes = [];
    for (let i = 0; i < numQueries; i++) {
        const cacheKey = `randomQuery:${i}`;
        const cachedResult = await redisClient.get(cacheKey);

        if (cachedResult) {
            queryTimes.push(JSON.parse(cachedResult));
        } else {
            const start = Date.now();
            const result = await sql.query`SELECT TOP 1 * FROM Earthquakes ORDER BY NEWID()`;
            const queryTime = Date.now() - start;

            await redisClient.setEx(cacheKey, 3600, JSON.stringify(queryTime)); // Cache for 1 hour
            queryTimes.push(queryTime);
        }
    }
    const averageTime = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
    return { queryTimes, averageTime };
};

const runRestrictedQueries = async (numQueries, restriction) => {
    let queryTimes = [];
    for (let i = 0; i < numQueries; i++) {
        const cacheKey = `restrictedQuery:${restriction}:${i}`;
        const cachedResult = await redisClient.get(cacheKey);

        if (cachedResult) {
            queryTimes.push(JSON.parse(cachedResult));
        } else {
            const start = Date.now();
            let query = `SELECT TOP 1 * FROM Earthquakes `;
            switch (restriction) {
                case 'CA':
                    query += `WHERE place LIKE '%CA%' ORDER BY NEWID()`;
                    break;
                case 'time_range':
                    query += `WHERE time BETWEEN '2023-01-01' AND '2023-12-31' ORDER BY NEWID()`;
                    break;
                case 'magnitude_range':
                    query += `WHERE mag BETWEEN 5.0 AND 6.0 ORDER BY NEWID()`;
                    break;
                case 'location_range':
                    const lat = 34.0522, lon = -118.2437, distance = 100; // Example: Los Angeles, CA
                    query += `
                        WHERE (POWER((latitude - ${lat}), 2) + POWER((longitude - ${lon}), 2)) < POWER(${distance}, 2)
                        ORDER BY NEWID()
                    `;
                    break;
            }
            await sql.query(query);
            const queryTime = Date.now() - start;

            await redisClient.setEx(cacheKey, 3600, JSON.stringify(queryTime)); // Cache for 1 hour
            queryTimes.push(queryTime);
        }
    }
    const averageTime = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
    return { queryTimes, averageTime };
};

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
