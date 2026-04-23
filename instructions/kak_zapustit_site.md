## В терминале Visual Studio Code

``` Set-ExecutionPolicy Bypass -Scope Process -Force ``` - обход защиты (каждый раз запускать надо)

``` cd frontend ``` - переход в директорию с фронтом (всё, что ниже, работает только тут)

``` npm install ``` - после каждого скачивания проекта с гита

``` npm run start ``` - запуск сайта на локалке

```uvicorn main:app --host 0.0.0.0 --port 8000 --reload ``` - запуск локалки, где, по идее, должно все работать 