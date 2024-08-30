const express = require('express');
const { Pool } = require('pg');
const Redis = require('redis');

const app = express();
app.use(express.json());

// PostgreSQL Pool
const pool = new Pool({
    user: 'your_db_user',
    host: 'localhost',
    database: 'mydatabase',
    password: '0000',
    port: 3000,
});

// Create a Redis client
const redisClient = Redis.createClient({
    url: 'redis://127.0.0.1:6379'  // Use the correct URL format for Redis connection
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

(async () => {
    await redisClient.connect();
})();

app.post('/articles', async (req, res) => {
    const { title, author, body } = req.body;

    if (!title || !author || !body) {
        return res.status(400).json({ error: 'Title, author, and body are required' });
    }

    try {
        // Insert the article into the database
        const result = await pool.query(`
            INSERT INTO articles (title, author, body, likes_count, views_count)
            VALUES ($1, $2, $3, 0, 0)
            RETURNING id, title, author, body, likes_count, views_count;
        `, [title, author, body]);

        // Return the inserted article details
        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fetching popular articles from Redis cache
app.get('/articles/popular', async (req, res) => {
    try {
        // Use zRange with reverse option to fetch sorted set in reverse order
        const popularArticles = await redisClient.zRange('popular_articles', 0, 9, { REV: true, WITHSCORES: true });
        res.json(popularArticles);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Liking an article
app.post('/articles/:id/like', async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;

    try {
        // Insert a like record, ignoring if it already exists
        await pool.query(`
            INSERT INTO article_likes (article_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT (article_id, user_id) DO NOTHING;
        `, [id, userId]);

        // Update likes count in the articles table
        await pool.query(`
            UPDATE articles
            SET likes_count = likes_count + 1
            WHERE id = $1;
        `, [id]);

        // Get the author of the article
        const articleResult = await pool.query('SELECT author FROM articles WHERE id = $1', [id]);
        const authorId = articleResult.rows[0].author;

        // Insert a notification for the author
        await pool.query(`
            INSERT INTO notifications (user_id, article_id, message)
            VALUES ($1, $2, 'Your article has been liked');
        `, [authorId, id]);

        // Update cache in Redis
        await redisClient.zIncrBy('popular_articles', 1, id);

        res.json({ message: 'Article liked and notification sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Viewing an article
app.post('/articles/:id/view', async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;

    try {
        // Insert a view record, ignoring if it already exists
        await pool.query(`
            INSERT INTO article_views (article_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT (article_id, user_id) DO NOTHING;
        `, [id, userId]);

        // Update views count in the articles table
        await pool.query(`
            UPDATE articles
            SET views_count = views_count + 1
            WHERE id = $1;
        `, [id]);

        // Update cache in Redis
        await redisClient.zIncrBy('popular_articles', 1, id);

        res.json({ message: 'Article viewed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
