require('dotenv').config(); // Loads environment variables from .env
const express = require('express'); // importing exrpess library i think
const { Pool } = require('pg'); // PostgreSQL connection library
const cors = require('cors'); // allows cross origin requests
const path = require('path'); // handles file paths
const bcrypt = require('bcrypt'); // importing library to use hashing algorithms for passwords
const session = require('express-session'); //Session handling, like on the webpage type stuff

const app = express();

// Middleware setup
app.use(cors()); // allow cross origin requests from different domains 
app.use(express.json()); // parse JSON from incoming requests
app.use(express.static(path.join(__dirname, 'FRONT_END'))); // serves static files (HTML, CSS,JS)

app.use( // configure session middleware
  session({
    secret: 'your_secret_key', // Replace with a secure secret key if actully live website
    resave: false, // prevents saving unchanged sessions 
    saveUninitialized: true, // saves uninitialized sessions 
    cookie: { secure: false }, // Set `true` if using HTTPS (if website is live)
  })
);

// PostgreSQL connection pool configurations 
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'Ticketer',
  password: 'Admin',
  port: 5432,
});

// tests connection to my postgreSQL database using pgAdmin as database gui
pool.connect((err) => {
  if (err) {
    console.error('Error connecting to Postgres', err.stack);
  } else {
    console.log('Connected to Postgres');
  }
});

// Middleware to check if user is authenticaticated 
const isAuthenticated = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Unauthorized. Please log in.' });
  }
  next(); // proceed tot he next middleware/route handler
};

// Routes

// Serve the main page(index/home)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'FRONT_END', 'index.html'));
});

// Serve the profile page(requires user auth)
app.get('/profile', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'FRONT_END', 'profile.html'));
});

// Serve the create ticket page(requires auth)
app.get('/create-ticket', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'FRONT_END', 'create-ticket.html'));
});

// Get all tickets from database
app.get('/api/tickets', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tickets'); // queries for tickets 
    res.json(result.rows);// send tickets as JSON response 
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Create a new ticket
app.post('/api/tickets', isAuthenticated, async (req, res) => {
  const { title, email, priority } = req.body; //Extract data from SQL request body
  try {
    const insertQuery = `
      INSERT INTO tickets (title, email, priority) 
      VALUES ($1, $2, $3) RETURNING *;
    `;
    const newTicket = await pool.query(insertQuery, [title, email, priority]); // Inserts newly created ticket into database
    res.json(newTicket.rows[0]); // returns the newly created tickets 
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Update ticket priority
app.put('/api/tickets/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params; // extract ticket id from the url 
  const { priority } = req.body; // extract the new prioirty from the request body

  try {
    const updateQuery = `
      UPDATE tickets 
      SET priority = $1 
      WHERE id = $2 
      RETURNING *;
    `;
    const result = await pool.query(updateQuery, [priority, id]); // updates the ticket table in database

    if (result.rowCount === 0) { // check if ticket is found 
      return res.status(404).json({ message: 'Ticket not found' });
    }

    res.json(result.rows[0]); // return updated ticket
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Delete a ticket
app.delete('/api/tickets/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params; // Extract ticket ID from the URL 

  try {
    const deleteQuery = 'DELETE FROM tickets WHERE id = $1;';
    await pool.query(deleteQuery, [id]); // Delete the ticket from database 
    res.json({ message: `Ticket ${id} deleted successfully` });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Register a user
app.post('/api/register', async (req, res) => {
  const { firstName, lastName, email, password } = req.body; // get user data from the request body

  if (!firstName || !lastName || !email || !password) { // validate input
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10); // hash password salts password 10 times 

    const insertQuery = `
      INSERT INTO users (first_name, last_name, email, password)
      VALUES ($1, $2, $3, $4)
      RETURNING id, first_name, last_name, email;
    `;
    const result = await pool.query(insertQuery, [
      firstName,
      lastName,
      email,
      hashedPassword,
    ]); // inserts user data and hashed password into the database

    res.status(201).json(result.rows[0]); // return new user
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// User login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body; // extracts login details 

  if (!email || !password) {
    return res.status(400).json({ message: 'All fields are required' }); // makes sure input is valid 
  }

  try {
    const query = 'SELECT * FROM users WHERE email = $1;';
    const result = await pool.query(query, [email]); // find user by emai;

    if (result.rows.length === 0) { // checl if user exists
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = result.rows[0]; // gets user data
    const isMatch = await bcrypt.compare(password, user.password); // compares password input to stored password

    if (!isMatch) { // checks if the passwords match
      return res.status(401).json({ message: 'Invalid email or password' });
    }
//store user data in the sesh
    req.session.user = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      isAdmin: user.is_admin,
    };

    const redirectPage = user.is_admin ? '/admin.html' : '/create-ticket.html'; // redirects screen reader based on role 
    res.json({ message: 'Login successful', redirect: redirectPage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => { // destroys session 
    if (err) {
      console.error('Error during logout:', err);
      return res.status(500).json({ message: 'Logout failed' });
    }
    res.json({ message: 'Logout Successful' }); // confirms logout 
  });
});

// Update profile
app.post('/api/update-profile', isAuthenticated, async (req, res) => {
  const { firstName, lastName, email } = req.body; // exrtact updated profile data 

  try {
    const query = `
      UPDATE users 
      SET first_name = $1, last_name = $2, email = $3 
      WHERE id = $4;
    `;
    await pool.query(query, [firstName, lastName, email, req.session.user.id]); //update user in the database
    res.json({ message: 'Profile updated successfully!' }); // confirm updata 
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Server error while updating profile.' });
  }
});

// Redirect to profile
app.post('/api/SwitchToProfile', isAuthenticated, (req, res) => {
  res.json({ redirect: '/profile' }); // send profile redirect repsonse 
});

// Start the server
const port = process.env.PORT || 3000; // use enviroment variable or defualts to 3000
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`); // confirms local host server is running will need to change if live site 
});
