import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const port = process.env.PORT || 8080;
const WECHAT_APPID = process.env.WECHAT_APPID;
const WECHAT_APPSECRET = process.env.WECHAT_APPSECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'default_secret';
const FAKE_EMAIL_DOMAIN = process.env.FAKE_EMAIL_DOMAIN || 'fake.mail.yourdomain.com';

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 授权端点
app.get('/authorize', (req, res) => {
    const redirectUri = encodeURIComponent(REDIRECT_URI);
    const state = 'your_state';
    const scope = 'snsapi_userinfo';

    console.log("Redirecting to WeChat authorization page");
    res.redirect(`https://open.weixin.qq.com/connect/oauth2/authorize?appid=${WECHAT_APPID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}#wechat_redirect`);
});

// 回调端点，仅用于接收 code 并返回给客户端
app.get('/callback', (req, res) => {
    console.log("Received callback request:", req.query);
    const code = req.query.code;
    const state = req.query.state;

    if (!code) {
        console.log("Missing code in callback request");
        return res.status(400).send('Missing code parameter');
    }

    // 将 code 重定向或返回给客户端
    const redirectUri = `${process.env.CLIENT_REDIRECT_URI}?code=${code}&state=${state}`;
    console.log("Redirecting to client with code:", code);
    res.redirect(redirectUri);
});

// 新增 access_token 端点，用于使用 code 获取 access_token
app.post('/access_token', async (req, res) => {
    const { code } = req.body;

    console.log("Received access token request with code:", code);

    if (!code) {
        console.log("Missing code in access token request");
        return res.status(400).send('Missing code parameter');
    }

    try {
        // 用 code 请求微信的 access_token
        console.log("Requesting access token from WeChat API...");
        const tokenResponse = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${WECHAT_APPID}&secret=${WECHAT_APPSECRET}&code=${code}&grant_type=authorization_code`);

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.log("Failed to fetch access token, response:", errorText);
            throw new Error('Failed to fetch access token');
        }

        const tokenData = await tokenResponse.json();
        console.log("Received token data from WeChat:", tokenData);

        const { access_token, openid, expires_in, refresh_token } = tokenData;

        if (!access_token) {
            console.log("Access token missing in WeChat response");
            return res.status(400).send('Failed to obtain access token');
        }

        // 将 access_token 和 openid 合并成一个字符串，以便客户端只需传递一个参数
        const combinedToken = `${access_token}:${openid}`;

        // 返回合并后的 access_token 和其他信息给客户端
        res.json({
            access_token: combinedToken,
            token_type: 'Bearer',
            expires_in,
            refresh_token
        });

    } catch (error) {
        console.error("Error in access token exchange:", error);
        res.status(500).send('Internal Server Error');
    }
});

// 用户信息端点
app.get('/userinfo', async (req, res) => {
    let access_token;

    // 1. 检查 Authorization 头是否包含 Bearer 令牌
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        access_token = authHeader.split(' ')[1];
    } else {
        access_token = req.query.access_token; // 备用：从 query 参数获取
    }

    if (!access_token) {
        return res.status(400).send('Missing access_token');
    }

    // 分离 access_token 和 openid
    const [token, openid] = access_token.split(':');
    if (!token || !openid) {
        return res.status(400).send('Invalid access_token format');
    }

    try {
        console.log("Requesting user info from WeChat API...");
        const userinfoResponse = await fetch(`https://api.weixin.qq.com/sns/userinfo?access_token=${token}&openid=${openid}&lang=zh_CN`);

        if (!userinfoResponse.ok) {
            throw new Error('Failed to fetch user info');
        }

        const userData = await userinfoResponse.json();
        console.log("Received user data from WeChat:", userData);

        // 将微信的字段映射到标准 OAuth2 字段
        const mappedUserData = {
            sub: userData.openid,
            name: userData.nickname,
            picture: userData.headimgurl,
            email: `${userData.openid}@${FAKE_EMAIL_DOMAIN}`,
            email_verified: 1,
            locale: userData.language || 'zh_CN',
            gender: userData.sex === 1 ? 'male' : userData.sex === 2 ? 'female' : 'unknown'
            // 其他标准 OAuth2 字段如 email 可根据需求自行扩展
        };

        console.log("mappedUserData:", mappedUserData);

        res.json({user:mappedUserData});
    } catch (error) {
        console.error("Error fetching user info:", error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
