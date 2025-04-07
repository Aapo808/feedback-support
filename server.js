import express from 'express';
import mysql from 'mysql2/promise';
import session from 'express-session';
import bcrypt from 'bcrypt';

const port = 3000;
const host = 'localhost';
// Tietokantayhteyden tiedot.
// Käyttäjänimi 'root' ja tyhjä salasana ovat XAMPP:n oletusarvot.

const dbHost = 'localhost';
const dbName = 'feedback_support';
const dbUser = 'root';
const dbPwd = '';
 
const app = express();
 
app.use('/inc', express.static('includes'));
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Lisää session middleware
app.use(session({
    secret: 'salainen avain', // Vaihda tämä turvalliseksi salaiseksi avaimen
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Aseta true HTTPS:lle
}));

// Oletusreitti
app.get('/', (req, res) => {
    res.redirect('/login'); // Ohjaa käyttäjä kirjautumissivulle
});

// Middleware tarkistaa, onko käyttäjä kirjautunut
const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    res.redirect('/login');
};

app.get('/feedback', isAuthenticated, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: dbHost,
            user: dbUser,
            password: dbPwd,
            database: dbName
        });
      
        const [rows] = await connection.execute('SELECT * FROM feedback');
   
        
        res.render('feedback', { rows: rows });

    } catch (err) {
        console.error('Database error:', err);
        res.status(500).send('Internal Server Error');
    } finally {
        if (connection) {
            try {
                await connection.end();
            } catch (closeError) {
                console.error('Error closing connection:', closeError);
            }
        }
    }
});

app.get('/asiakkaat', isAuthenticated, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: dbHost,
            user: dbUser,
            password: dbPwd,
            database: dbName
        });
      
        const [rows] = await connection.execute('SELECT customer.name, system_user.id, system_user.fullname, system_user.email, system_user.admin FROM customer right join system_user on system_user.customer_id=customer.id');
        res.render('asiakkaat', { rows: rows });

    } catch (err) {
        console.error('Database error:', err);
        res.status(500).send('Internal Server Error');
    } finally {
        if (connection) {
            try {
                await connection.end();
            } catch (closeError) {
                console.error('Error closing connection:', closeError);
            }
        }
    }
});

app.get('/tukipyynto', isAuthenticated, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: dbHost,
            user: dbUser,
            password: dbPwd,
            database: dbName
        });
      
        const [rows] = await connection.execute('SELECT support_ticket.id, support_ticket.arrived, support_ticket.description,support_ticket.handled,customer.name ,ticket_status.description as status FROM support_ticket join customer on support_ticket.customer_id = customer.id join ticket_status on support_ticket.status=ticket_status.id ORDER BY arrived DESC');
   
        if (!rows) {
            throw new Error('Tietoja ei löytynyt');
        }

        res.render('tukipyynto', { rows: rows });

    } catch (err) {
        console.error('Database error:', err);
        res.status(500).send('Tietokantavirhe: ' + err.message);
    } finally {
        if (connection) {
            try {
                await connection.end();
            } catch (closeError) {
                console.error('Error closing connection:', closeError);
            }
        }
    }
});

app.get('/tukipyynto/:id', async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: dbHost,
            user: dbUser,
            password: dbPwd,
            database: dbName
        });

        // Hae tukipyyntö
        const [ticket] = await connection.execute(`
            SELECT support_ticket.id, support_ticket.arrived, support_ticket.description,
                   support_ticket.handled, customer.name, 
                   ticket_status.description as status 
            FROM support_ticket 
            JOIN customer ON support_ticket.customer_id = customer.id 
            JOIN ticket_status ON support_ticket.status = ticket_status.id 
            WHERE support_ticket.id = ?
        `, [req.params.id]);

        // Hae viestit
        const [messages] = await connection.execute(`
            SELECT ticket_message.*, system_user.fullname 
            FROM ticket_message 
            JOIN system_user ON ticket_message.user_id = system_user.id 
            WHERE ticket_id = ? 
            ORDER BY sent ASC
        `, [req.params.id]);

        res.render('ticket', { ticket: ticket[0], messages: messages });

    } catch (err) {
        console.error('Database error:', err);
        res.status(500).send('Tietokantavirhe: ' + err.message);
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/tukipyynto/:id/vastaa', async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: dbHost,
            user: dbUser,
            password: dbPwd,
            database: dbName
        });

        // Käytä käyttäjä ID 16 jos checkbox on valittu, muuten käytä ID 2
        const userId = req.body.isAdmin ? 16 : 2;

        await connection.execute(`
            INSERT INTO ticket_message (ticket_id, user_id, message, sent) 
            VALUES (?, ?, ?, NOW())
        `, [req.params.id, userId, req.body.message]);

        res.redirect('/tukipyynto/' + req.params.id);

    } catch (err) {
        console.error('Database error:', err);
        res.status(500).send('Tietokantavirhe: ' + err.message);
    } finally {
        if (connection) await connection.end();
    }
});

app.post('/tukipyynto/:id/status', async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: dbHost,
            user: dbUser,
            password: dbPwd,
            database: dbName
        });

        const ticketId = req.params.id;
        const newStatus = req.body.status; // Tämä on nyt suoraan numero (1-5)

        // Päivitetään tukipyynnön tila
        if (newStatus === '5') { // Jos status on "Suljettu"
            await connection.execute(`
                UPDATE support_ticket SET status = ?, handled = CURRENT_TIMESTAMP WHERE id = ?
            `, [newStatus, ticketId]);
        } else {
            await connection.execute(`
                UPDATE support_ticket SET status = ? WHERE id = ?
            `, [newStatus, ticketId]);
        }

        // Hae päivitetty tukipyyntö
        const [ticket] = await connection.execute(`
            SELECT support_ticket.id, support_ticket.arrived, support_ticket.description,
                   support_ticket.handled, customer.name, 
                   ticket_status.description as status 
            FROM support_ticket 
            JOIN customer ON support_ticket.customer_id = customer.id 
            JOIN ticket_status ON support_ticket.status = ticket_status.id 
            WHERE support_ticket.id = ?
        `, [ticketId]);

        // Hae viestit
        const [messages] = await connection.execute(`
            SELECT ticket_message.*, system_user.fullname 
            FROM ticket_message 
            JOIN system_user ON ticket_message.user_id = system_user.id 
            WHERE ticket_id = ? 
            ORDER BY sent ASC
        `, [ticketId]);

        res.render('ticket', { ticket: ticket[0], messages: messages });

    } catch (err) {
        console.error('Database error:', err);
        res.status(500).send('Tietokantavirhe: ' + err.message);
    } finally {
        if (connection) await connection.end();
    }
});

// Kirjautumissivu
app.get('/login', (req, res) => {
    res.render('login');
});

// Kirjautuminen
app.post('/login', async (req, res) => {
    const { identifier, password } = req.body;
    let connection;

    try {
        connection = await mysql.createConnection({
            host: dbHost,
            user: dbUser,
            password: dbPwd,
            database: dbName
        });

        console.log('Identifier:', identifier);
        console.log('Password:', password);

        // Hae käyttäjä ID:n tai sähköpostin perusteella
        const [rows] = await connection.execute(`
            SELECT * FROM system_user WHERE (id = ? OR email = ?) AND admin = TRUE
        `, [identifier, identifier]);

        if (rows.length > 0) {
            const user = rows[0];
            if (!user.PASSWORD) {
                return res.status(500).send('Salasana ei ole määritelty.');
            }
            bcrypt.compare(password, user.PASSWORD, (err, match) => {
                if (match) {
                    req.session.user = { id: user.id, username: user.username };
                    return res.redirect("/asiakkaat");
                } else {
                    return res.render("login", { message: "Login not successful" });
                }
            });
        } else {
            return res.render("login", { message: "Login not successful" });
        }
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).send('Tietokantavirhe: ' + err.message);
    } finally {
        if (connection) await connection.end();
    }
});

// Kirjaudu ulos
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/feedback');
        }
        res.redirect('/login');
    });
});

app.listen(port, host, console.log('servu pyörii'));