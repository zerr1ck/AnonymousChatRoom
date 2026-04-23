# 匿名聊天室

一个基于 Flask + WebSocket 开发的匿名公共聊天室网站。

## 功能特性

- 无需注册，访问即可聊天
- 自动生成随机用户ID
- 实时消息传输
- 在线用户列表显示
- 正在输入提示
- XSS攻击防护
- 响应式设计，支持多种设备

## 技术栈

- **后端**: Python 3 + Flask + Flask-SocketIO
- **实时通信**: WebSocket (Socket.IO)
- **前端**: HTML5 + CSS3 + JavaScript
- **测试**: pytest

## 项目结构

```
chat_room/
├── app.py                 # 主应用文件
├── requirements.txt       # 依赖列表
├── README.md              # 项目文档
├── venv/                  # 虚拟环境（可选）
├── templates/
│   └── index.html         # 前端页面
├── static/
│   ├── css/
│   │   └── style.css      # 样式文件
│   └── js/
│       └── chat.js        # 前端脚本
└── tests/
    └── test_app.py        # 测试文件
```

## 安装和运行

### 环境要求

- Python 3.8+
- pip

### 安装步骤

1. **克隆项目**（或下载源码）

2. **创建虚拟环境**（推荐）

```bash
python -m venv venv
```

3. **激活虚拟环境**

- Windows:
```bash
venv\Scripts\activate
```

- Linux/Mac:
```bash
source venv/bin/activate
```

4. **安装依赖**

```bash
pip install -r requirements.txt
```

### 启动服务器

```bash
python app.py
```

服务器将在 `http://localhost:5000` 启动。

### 访问聊天室

打开浏览器访问 `http://localhost:5000` 即可进入聊天室。

## API 接口

### HTTP 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | / | 返回聊天室页面 |

### WebSocket 事件

#### 客户端发送事件

| 事件名 | 参数 | 描述 |
|--------|------|------|
| send_message | `{user_id, message}` | 发送消息 |
| typing | `{user_id}` | 开始输入 |
| stop_typing | `{user_id}` | 停止输入 |

#### 服务端发送事件

| 事件名 | 参数 | 描述 |
|--------|------|------|
| user_id | `{user_id}` | 返回用户ID |
| user_join | `{user_id}` | 用户加入 |
| user_leave | `{user_id}` | 用户离开 |
| online_users | `{count, users}` | 在线用户列表 |
| load_messages | `{messages}` | 历史消息 |
| new_message | `{user_id, message, timestamp}` | 新消息 |
| user_typing | `{user_id}` | 用户正在输入 |
| user_stop_typing | `{user_id}` | 用户停止输入 |
| error | `{message}` | 错误信息 |

## 测试

运行测试：

```bash
python -m pytest tests/ -v
```

## 安全特性

- 使用 `html.escape()` 进行XSS防护
- 消息长度限制（最大500字符）
- 空消息过滤
- 用户ID验证

## 部署

### 开发环境

直接运行 `python app.py` 即可。

### 生产环境

推荐使用 Gunicorn + eventlet：

```bash
pip install gunicorn eventlet
gunicorn --worker-class eventlet -w 1 app:app
```

### Docker 部署（可选）

创建 `Dockerfile`:

```dockerfile
FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

EXPOSE 5000

CMD ["python", "app.py"]
```

构建并运行：

```bash
docker build -t chat-room .
docker run -p 5000:5000 chat-room
```

## 许可证

MIT License